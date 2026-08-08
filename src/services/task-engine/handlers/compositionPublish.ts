import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import compressing from "compressing";
import u from "@/utils";
import { db } from "@/utils/db";
import { TaskExecutionError } from "@/domain/generationTask";
import type { GenerationTask } from "@/domain/generationTask";
import type { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { serializeSubtitles } from "@/services/voice-studio/dialogue";

const sql = db as any;

export interface CompositionPublishTaskPayload {
  projectId: number;
  scriptId: number;
  packageId: string;
  compositionJobId: string;
  outputPath: string;
  outputChecksum: string;
  timelineId: string;
  qaReportId: string;
  reviewId: string;
  packagePath: string;
  model: "local:publish-zip";
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash as any);
  return hash.digest("hex");
}

async function replaceFileAtomically(source: string, destination: string): Promise<void> {
  try {
    await fsp.rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !["EEXIST", "EPERM", "ENOTEMPTY"].includes(code)) throw error;
    await fsp.rm(destination, { force: true });
    await fsp.rename(source, destination);
  }
}

async function writeZipWithCancellation(zip: NodeJS.ReadableStream, outputPath: string, context: TaskHandlerContext): Promise<void> {
  const output = fs.createWriteStream(outputPath);
  let checking = false;
  const cancelTimer = setInterval(() => {
    if (checking) return;
    checking = true;
    void context.throwIfCancelled().catch((error) => {
      (zip as NodeJS.ReadableStream & { destroy(error?: Error): void }).destroy(error as Error);
      output.destroy(error as Error);
    }).finally(() => { checking = false; });
  }, 1_000);
  cancelTimer.unref?.();
  try {
    await pipeline(zip as any, output);
  } finally {
    clearInterval(cancelTimer);
  }
}

async function assertLatestReview(payload: CompositionPublishTaskPayload): Promise<void> {
  const latest = await sql("composition_reviews")
    .where({ composition_job_id: payload.compositionJobId, output_checksum: payload.outputChecksum })
    .orderBy("created_at", "desc")
    .first();
  if (!latest || latest.id !== payload.reviewId || latest.status !== "approved") {
    throw new TaskExecutionError("当前成片审核已变化，发布包任务已失效", "PUBLISH_REVIEW_SUPERSEDED", false, true);
  }
}

export const compositionPublishTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as CompositionPublishTaskPayload;
    const [packageRow, job, timeline, qa, review, script] = await Promise.all([
      sql("publish_packages").where({ id: payload.packageId, project_id: payload.projectId }).first(),
      sql("composition_jobs").where({ id: payload.compositionJobId, project_id: payload.projectId, script_id: payload.scriptId }).first(),
      sql("project_timelines").where({ id: payload.timelineId, project_id: payload.projectId, script_id: payload.scriptId }).first(),
      sql("media_qa_reports").where({ id: payload.qaReportId, composition_job_id: payload.compositionJobId }).first(),
      sql("composition_reviews").where({ id: payload.reviewId, composition_job_id: payload.compositionJobId }).first(),
      sql("o_script").where({ id: payload.scriptId, projectId: payload.projectId }).first(),
    ]);
    if (!packageRow || !job || !timeline || !qa || !review || !script) throw new TaskExecutionError("发布包输入记录不存在", "PUBLISH_INPUT_NOT_FOUND", false, true);
    const qaResult = typeof qa.result === "string" ? JSON.parse(qa.result) : qa.result;
    if (job.status !== "succeeded" || job.preset !== "final-high" || job.output_checksum !== payload.outputChecksum || qa.status !== "succeeded" || qa.output_checksum !== payload.outputChecksum || !qaResult?.summary || qaResult.summary.status === "failed" || review.status !== "approved" || review.output_checksum !== payload.outputChecksum) {
      throw new TaskExecutionError("成片、QA 或审核关卡已变化，请重新创建发布包", "PUBLISH_GATE_CHANGED", false, true);
    }
    await assertLatestReview(payload);
    const videoAbsolute = await u.oss.getAbsolutePath(payload.outputPath);
    const videoStat = await fsp.stat(videoAbsolute).catch(() => null);
    if (!videoStat?.isFile()) throw new TaskExecutionError("成片文件不存在", "PUBLISH_VIDEO_MISSING", false, true);
    await context.throwIfCancelled();
    await context.transitionToPolling();
    await sql("publish_packages").where("id", payload.packageId).update({ status: "running", error_message: null, updated_at: Date.now() });

    const packageAbsolute = await u.oss.getAbsolutePath(payload.packagePath);
    const partialPath = `${packageAbsolute}.partial-${task.id}`;
    let finalPathWritten = false;
    await fsp.mkdir(path.dirname(packageAbsolute), { recursive: true });
    await fsp.rm(partialPath, { force: true });
    try {
      const actualVideoChecksum = await sha256File(videoAbsolute);
      if (actualVideoChecksum !== payload.outputChecksum) {
        throw new TaskExecutionError("高清成片文件校验和已变化，请重新渲染、QA 和审核", "PUBLISH_VIDEO_CHECKSUM_CHANGED", false, true);
      }
      await context.throwIfCancelled();
      const timelinePayload = typeof timeline.payload === "string" ? JSON.parse(timeline.payload) : timeline.payload;
      const timelineCues = (timelinePayload.subtitleTracks || [])
        .flatMap((track: any) => track.cues || [])
        .sort((a: any, b: any) => a.startMs - b.startMs);
      const srt = serializeSubtitles(timelineCues, "srt");
      const vtt = serializeSubtitles(timelineCues, "vtt");
      const timelineBuffer = Buffer.from(JSON.stringify(timelinePayload, null, 2));
      const qaBuffer = Buffer.from(JSON.stringify(qaResult, null, 2));
      const reviewBuffer = Buffer.from(JSON.stringify({ status: review.status, note: review.note, reviewer: review.reviewer, createdAt: review.created_at, outputChecksum: review.output_checksum }, null, 2));
      const srtBuffer = Buffer.from(srt);
      const vttBuffer = Buffer.from(vtt);
      const fileChecksums: Record<string, string> = {
        "video/final.mp4": actualVideoChecksum,
        "subtitles/subtitles.srt": sha256Buffer(srtBuffer),
        "subtitles/subtitles.vtt": sha256Buffer(vttBuffer),
        "evidence/timeline.json": sha256Buffer(timelineBuffer),
        "evidence/qa-report.json": sha256Buffer(qaBuffer),
        "evidence/review.json": sha256Buffer(reviewBuffer),
      };
      const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectId: payload.projectId,
        script: { id: payload.scriptId, name: script.name },
        composition: {
          jobId: job.id,
          preset: job.preset,
          timelineId: timeline.id,
          timelineVersion: timeline.version,
          timelineChecksum: timeline.checksum,
          outputChecksum: payload.outputChecksum,
          durationMs: job.duration_ms,
        },
        quality: { reportId: qa.id, status: qaResult.summary.status, errors: qaResult.summary.errors, warnings: qaResult.summary.warnings },
        review: { id: review.id, status: review.status, reviewer: review.reviewer, note: review.note ?? null },
        files: fileChecksums,
      };
      const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2));
      const allChecksums = { ...fileChecksums, "manifest.json": sha256Buffer(manifestBuffer) };
      const checksumsBuffer = Buffer.from(Object.entries(allChecksums).map(([file, checksum]) => `${checksum}  ${file}`).join("\n") + "\n");
      const zip = new compressing.zip.Stream();
      zip.addEntry(videoAbsolute, { relativePath: "video/final.mp4" });
      zip.addEntry(srtBuffer, { relativePath: "subtitles/subtitles.srt" });
      zip.addEntry(vttBuffer, { relativePath: "subtitles/subtitles.vtt" });
      zip.addEntry(timelineBuffer, { relativePath: "evidence/timeline.json" });
      zip.addEntry(qaBuffer, { relativePath: "evidence/qa-report.json" });
      zip.addEntry(reviewBuffer, { relativePath: "evidence/review.json" });
      zip.addEntry(manifestBuffer, { relativePath: "manifest.json" });
      zip.addEntry(checksumsBuffer, { relativePath: "checksums.sha256" });
      await writeZipWithCancellation(zip as any, partialPath, context);
      await context.throwIfCancelled();
      await assertLatestReview(payload);
      await context.transitionToFinalizing();
      await replaceFileAtomically(partialPath, packageAbsolute);
      finalPathWritten = true;
      const [packageChecksum, stat] = await Promise.all([sha256File(packageAbsolute), fsp.stat(packageAbsolute)]);
      await db.transaction(async (trx) => {
        const latestReview = await trx("composition_reviews")
          .where({ composition_job_id: payload.compositionJobId, output_checksum: payload.outputChecksum })
          .orderBy("created_at", "desc")
          .first();
        const currentTask = await trx("generation_tasks").where("id", task.id).first();
        if (!latestReview || latestReview.id !== payload.reviewId || latestReview.status !== "approved") {
          throw new TaskExecutionError("当前成片审核已变化，发布包任务已失效", "PUBLISH_REVIEW_SUPERSEDED", false, true);
        }
        if (!currentTask || currentTask.cancel_requested === 1 || ["cancelling", "cancelled"].includes(currentTask.status)) {
          throw new TaskExecutionError("发布包任务已取消", "PUBLISH_CANCELLED", false, true);
        }
        const updated = await trx("publish_packages").where({ id: payload.packageId, review_id: payload.reviewId }).whereNot("status", "revoked").update({
          status: "succeeded",
          package_path: payload.packagePath,
          package_checksum: packageChecksum,
          size_bytes: stat.size,
          manifest: JSON.stringify(manifest),
          error_message: null,
          updated_at: Date.now(),
        });
        if (updated !== 1) throw new TaskExecutionError("发布包记录已失效", "PUBLISH_PACKAGE_REVOKED", false, true);
      });
      return { packageId: payload.packageId, packagePath: payload.packagePath, packageChecksum, sizeBytes: stat.size, manifest };
    } catch (error) {
      await fsp.rm(partialPath, { force: true }).catch(() => undefined);
      if (finalPathWritten) await fsp.rm(packageAbsolute, { force: true }).catch(() => undefined);
      await sql("publish_packages").where("id", payload.packageId).whereNot("status", "revoked").update({ status: "failed", error_message: error instanceof Error ? error.message : String(error), updated_at: Date.now() }).catch(() => undefined);
      throw error;
    }
  },
};
