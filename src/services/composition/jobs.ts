import { v4 as uuid } from "uuid";
import u from "@/utils";
import { db } from "@/utils/db";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { CompositionRenderPreset } from "@/services/composition/renderer";
import { CompositionRenderTaskPayload } from "@/services/task-engine/handlers/compositionRender";

const sql = db as any;

async function mapJob(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    timelineId: row.timeline_id,
    timelineVersion: row.timeline_version,
    renderer: row.renderer,
    preset: row.preset,
    status: row.status,
    outputPath: row.output_path ?? null,
    outputUrl: row.output_path ? await u.oss.getFileUrl(row.output_path) : null,
    inputChecksum: row.input_checksum,
    outputChecksum: row.output_checksum ?? null,
    durationMs: row.duration_ms ?? null,
    taskId: row.task_id ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLatestCompositionJob(input: { projectId: number; scriptId: number }) {
  const row = await sql("composition_jobs")
    .where({ project_id: input.projectId, script_id: input.scriptId })
    .orderBy("created_at", "desc")
    .first();
  return mapJob(row);
}

export async function enqueueCompositionRender(input: {
  projectId: number;
  scriptId: number;
  timelineId: string;
  preset: CompositionRenderPreset;
  requestId: string;
}) {
  const timeline = await sql("project_timelines")
    .where({ id: input.timelineId, project_id: input.projectId, script_id: input.scriptId })
    .first();
  if (!timeline) throw new Error("时间线不存在或不属于当前项目剧本");
  const payload = JSON.parse(timeline.payload);
  const clipCount = (payload.videoTracks || []).reduce((total: number, track: any) => total + (track.clips?.length || 0), 0);
  if (clipCount === 0) throw new Error("时间线没有已选视频，请先完成选片并重新构建时间线");

  const inputChecksum = stableIdempotencyKey({
    renderer: "ffmpeg",
    rendererVersion: 3,
    preset: input.preset,
    timelineChecksum: timeline.checksum,
  });
  const previous = await sql("composition_jobs")
    .where({ timeline_id: timeline.id, preset: input.preset, input_checksum: inputChecksum })
    .orderBy("created_at", "desc")
    .first();
  if (previous?.status === "succeeded" && previous.output_path && (await u.oss.fileExists(previous.output_path))) {
    return { job: await mapJob(previous), task: previous.task_id ? await generationTaskRepository.get(previous.task_id) : null, cached: true, deduped: true };
  }
  if (previous && ["queued", "rendering"].includes(previous.status) && previous.task_id) {
    const task = await generationTaskRepository.get(previous.task_id);
    if (task && !["cancelled", "succeeded", "failed"].includes(task.status)) {
      return { job: await mapJob(previous), task, cached: false, deduped: true };
    }
  }

  const jobId = uuid();
  const outputPath = `/${input.projectId}/composition/${input.scriptId}/timeline-v${timeline.version}-${timeline.checksum.slice(0, 12)}-${input.preset}.mp4`;
  const now = Date.now();
  await sql("composition_jobs").insert({
    id: jobId,
    project_id: input.projectId,
    script_id: input.scriptId,
    timeline_id: timeline.id,
    timeline_version: timeline.version,
    renderer: "ffmpeg",
    preset: input.preset,
    status: "queued",
    output_path: null,
    input_checksum: inputChecksum,
    task_id: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  const [legacyTaskId] = await sql("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "视频合成",
    relatedObjects: JSON.stringify({ compositionJobId: jobId, timelineId: timeline.id }),
    model: "ffmpeg",
    describe: `${input.preset === "final-high" ? "本地高清成片" : "本地低清预览"}：时间线 v${timeline.version}，${clipCount} 个片段`,
    state: "排队中",
    startTime: now,
  });
  const taskPayload: CompositionRenderTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    compositionJobId: jobId,
    timelineId: timeline.id,
    timelineVersion: timeline.version,
    timelineChecksum: timeline.checksum,
    preset: input.preset,
    outputPath,
    model: "local:ffmpeg",
  };
  try {
    const result = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "compose",
      type: "composition.render",
      resourceKey: `composition:timeline:${timeline.id}:${input.preset}`,
      payload: taskPayload,
      provider: "local",
      idempotencyKey: stableIdempotencyKey({ type: "composition.render", inputChecksum, requestId: input.requestId }),
      maxAttempts: 2,
    });
    if (result.deduped) {
      await Promise.all([
        sql("composition_jobs").where("id", jobId).delete(),
        sql("o_tasks").where("id", legacyTaskId).delete(),
      ]);
      const existingJob = await sql("composition_jobs").where("task_id", result.task.id).first();
      return { job: await mapJob(existingJob), task: result.task, cached: false, deduped: true };
    }
    await sql("composition_jobs").where("id", jobId).update({ task_id: result.task.id, updated_at: Date.now() });
    return { job: await mapJob(await sql("composition_jobs").where("id", jobId).first()), task: result.task, cached: false, deduped: false };
  } catch (error) {
    await Promise.all([
      sql("composition_jobs").where("id", jobId).delete(),
      sql("o_tasks").where("id", legacyTaskId).delete(),
    ]);
    throw error;
  }
}
