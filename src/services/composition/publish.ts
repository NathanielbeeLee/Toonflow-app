import { v4 as uuid } from "uuid";
import u from "@/utils";
import { db } from "@/utils/db";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import type { CompositionPublishTaskPayload } from "@/services/task-engine/handlers/compositionPublish";

const sql = db as any;

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}

async function mapPackage(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    compositionJobId: row.composition_job_id,
    outputChecksum: row.output_checksum,
    qaReportId: row.qa_report_id,
    reviewId: row.review_id,
    status: row.status,
    packagePath: row.package_path ?? null,
    packageUrl: row.package_path ? await u.oss.getFileUrl(row.package_path) : null,
    packageChecksum: row.package_checksum ?? null,
    sizeBytes: row.size_bytes ?? null,
    manifest: parseJson(row.manifest),
    taskId: row.task_id ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLatestPublishPackage(input: { projectId: number; scriptId: number }) {
  return mapPackage(await sql("publish_packages").where({ project_id: input.projectId, script_id: input.scriptId }).orderBy("created_at", "desc").first());
}

export async function enqueuePublishPackage(input: { projectId: number; scriptId: number; compositionJobId: string; requestId: string }) {
  const job = await sql("composition_jobs").where({ id: input.compositionJobId, project_id: input.projectId, script_id: input.scriptId }).first();
  if (!job || job.status !== "succeeded" || job.preset !== "final-high" || !job.output_path || !job.output_checksum) throw new Error("请先完成高清成片渲染");
  if (!(await u.oss.fileExists(job.output_path))) throw new Error("高清成片文件不存在，请重新渲染");
  const qa = await sql("media_qa_reports").where({ composition_job_id: job.id, output_checksum: job.output_checksum }).orderBy("created_at", "desc").first();
  const qaResult = parseJson(qa?.result);
  if (!qa || qa.status !== "succeeded" || !qaResult?.summary) throw new Error("请先完成当前高清成片的媒体 QA");
  if (qaResult.summary.status === "failed") throw new Error("媒体 QA 仍有阻断错误，不能创建发布包");
  const review = await sql("composition_reviews").where({ composition_job_id: job.id, output_checksum: job.output_checksum }).orderBy("created_at", "desc").first();
  if (!review || review.status !== "approved") throw new Error("请先审核通过当前高清成片");
  const previous = await sql("publish_packages").where({ composition_job_id: job.id, output_checksum: job.output_checksum, qa_report_id: qa.id, review_id: review.id }).first();
  if (previous?.status === "succeeded" && previous.package_path && await u.oss.fileExists(previous.package_path)) {
    return { package: await mapPackage(previous), task: previous.task_id ? await generationTaskRepository.get(previous.task_id) : null, cached: true, deduped: true };
  }
  if (previous && ["queued", "running"].includes(previous.status) && previous.task_id) {
    const task = await generationTaskRepository.get(previous.task_id);
    if (task && !["cancelled", "failed", "succeeded"].includes(task.status)) return { package: await mapPackage(previous), task, cached: false, deduped: true };
  }
  const packageId = previous?.id ?? uuid();
  const createdPackage = !previous;
  const now = Date.now();
  const packagePath = `/${input.projectId}/publish/${input.scriptId}/delivery-${job.output_checksum.slice(0, 16)}.zip`;
  const packageRow = {
    project_id: input.projectId,
    script_id: input.scriptId,
    composition_job_id: job.id,
    output_checksum: job.output_checksum,
    qa_report_id: qa.id,
    review_id: review.id,
    status: "queued",
    package_path: null,
    package_checksum: null,
    size_bytes: null,
    manifest: null,
    task_id: null,
    error_message: null,
    updated_at: now,
  };
  if (createdPackage) await sql("publish_packages").insert({ id: packageId, ...packageRow, created_at: now });
  const [legacyTaskId] = await sql("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "发布交付包",
    relatedObjects: JSON.stringify({ packageId, compositionJobId: job.id }),
    model: "local-zip",
    describe: `高清成片发布包：时间线 v${job.timeline_version}`,
    state: "排队中",
    startTime: now,
  });
  const payload: CompositionPublishTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    packageId,
    compositionJobId: job.id,
    outputPath: job.output_path,
    outputChecksum: job.output_checksum,
    timelineId: job.timeline_id,
    qaReportId: qa.id,
    reviewId: review.id,
    packagePath,
    model: "local:publish-zip",
  };
  try {
    const queued = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "publish",
      type: "composition.publish",
      resourceKey: `publish:composition:${job.id}`,
      payload,
      provider: "local",
      idempotencyKey: stableIdempotencyKey({ type: "composition.publish", outputChecksum: job.output_checksum, qaReportId: qa.id, reviewId: review.id, requestId: input.requestId }),
      maxAttempts: 2,
    });
    if (queued.deduped) {
      await sql("o_tasks").where("id", legacyTaskId).delete();
      if (createdPackage) await sql("publish_packages").where("id", packageId).delete();
      const existingPackage = await sql("publish_packages").where("task_id", queued.task.id).first();
      return { package: await mapPackage(existingPackage || previous), task: queued.task, cached: false, deduped: true };
    }
    await sql("publish_packages").where("id", packageId).update({ ...packageRow, task_id: queued.task.id, updated_at: Date.now() });
    return { package: await mapPackage(await sql("publish_packages").where("id", packageId).first()), task: queued.task, cached: false, deduped: false };
  } catch (error) {
    await sql("o_tasks").where("id", legacyTaskId).delete();
    if (createdPackage) await sql("publish_packages").where("id", packageId).delete();
    throw error;
  }
}
