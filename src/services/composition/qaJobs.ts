import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import u from "@/utils";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { CompositionQaTaskPayload } from "@/services/task-engine/handlers/compositionQa";

const sql = db as any;

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function mapReport(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    compositionJobId: row.composition_job_id,
    timelineId: row.timeline_id,
    outputChecksum: row.output_checksum,
    status: row.status,
    result: parseJson(row.result),
    taskId: row.task_id ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLatestQaReport(input: { projectId: number; scriptId: number }) {
  return mapReport(await sql("media_qa_reports").where({ project_id: input.projectId, script_id: input.scriptId }).orderBy("created_at", "desc").first());
}

export async function enqueueCompositionQa(input: { projectId: number; scriptId: number; compositionJobId: string; requestId: string }) {
  const job = await sql("composition_jobs").where({ id: input.compositionJobId, project_id: input.projectId, script_id: input.scriptId }).first();
  if (!job || job.status !== "succeeded" || !job.output_path || !job.output_checksum) throw new Error("请先完成可用的成片渲染");
  if (!(await u.oss.fileExists(job.output_path))) throw new Error("成片文件不存在，请重新渲染");
  const previous = await sql("media_qa_reports")
    .where({ composition_job_id: job.id, output_checksum: job.output_checksum })
    .orderBy("created_at", "desc")
    .first();
  if (previous?.status === "succeeded") return { report: mapReport(previous), task: previous.task_id ? await generationTaskRepository.get(previous.task_id) : null, cached: true, deduped: true };
  if (previous && ["queued", "running"].includes(previous.status) && previous.task_id) {
    const task = await generationTaskRepository.get(previous.task_id);
    if (task && !["cancelled", "failed", "succeeded"].includes(task.status)) return { report: mapReport(previous), task, cached: false, deduped: true };
  }
  const timeline = await sql("project_timelines").where({ id: job.timeline_id, project_id: input.projectId, script_id: input.scriptId }).first();
  if (!timeline) throw new Error("成片对应的时间线不存在");
  const reportId = uuid();
  const now = Date.now();
  await sql("media_qa_reports").insert({
    id: reportId,
    project_id: input.projectId,
    script_id: input.scriptId,
    composition_job_id: job.id,
    timeline_id: timeline.id,
    output_checksum: job.output_checksum,
    status: "queued",
    result: null,
    task_id: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  const [legacyTaskId] = await sql("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "媒体 QA",
    relatedObjects: JSON.stringify({ reportId, compositionJobId: job.id }),
    model: "ffmpeg-qa",
    describe: `本地成片 QA：时间线 v${job.timeline_version}`,
    state: "排队中",
    startTime: now,
  });
  const payload: CompositionQaTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    reportId,
    compositionJobId: job.id,
    timelineId: timeline.id,
    outputPath: job.output_path,
    outputChecksum: job.output_checksum,
    expectedDurationMs: job.duration_ms,
    preset: job.preset,
    model: "local:ffmpeg-qa",
  };
  try {
    const queued = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "qa",
      type: "composition.qa",
      resourceKey: `qa:composition:${job.id}`,
      payload,
      provider: "local",
      idempotencyKey: stableIdempotencyKey({ type: "composition.qa", outputChecksum: job.output_checksum, requestId: input.requestId }),
      maxAttempts: 2,
    });
    if (queued.deduped) {
      await Promise.all([sql("media_qa_reports").where("id", reportId).delete(), sql("o_tasks").where("id", legacyTaskId).delete()]);
      const existingReport = await sql("media_qa_reports").where("task_id", queued.task.id).first();
      return { report: mapReport(existingReport), task: queued.task, cached: false, deduped: true };
    }
    await sql("media_qa_reports").where("id", reportId).update({ task_id: queued.task.id, updated_at: Date.now() });
    return { report: mapReport(await sql("media_qa_reports").where("id", reportId).first()), task: queued.task, cached: false, deduped: queued.deduped };
  } catch (error) {
    await Promise.all([sql("media_qa_reports").where("id", reportId).delete(), sql("o_tasks").where("id", legacyTaskId).delete()]);
    throw error;
  }
}
