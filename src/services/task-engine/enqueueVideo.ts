import { v4 as uuid } from "uuid";
import u from "@/utils";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { VideoGenerationTaskPayload } from "@/services/task-engine/handlers/videoGeneration";

interface EnqueueVideoInput {
  projectId: number;
  scriptId: number;
  trackId: number;
  uploadData: Array<{ id: number; sources: string }>;
  prompt: string;
  duration: number;
  model: `${string}:${string}`;
  mode: string | string[];
  resolution: string;
  audio?: boolean;
  requestId: string;
}

export async function enqueueVideoGeneration(input: EnqueueVideoInput) {
  const resourceKey = `video:${input.projectId}:${input.scriptId}:${input.trackId}`;
  const idempotencyKey = stableIdempotencyKey({ requestId: input.requestId, resourceKey, type: "video.generate" });
  const existing = await generationTaskRepository.list({ projectId: input.projectId, type: "video.generate", limit: 100 });
  const active = existing.data.find(
    (task) =>
      task.resourceKey === resourceKey &&
      !["cancelled", "succeeded", "failed"].includes(task.status),
  );
  if (active) {
    const payload = active.payload as VideoGenerationTaskPayload;
    return { task: active, videoId: payload.videoId, deduped: true };
  }

  const ratio = await u.db("o_project").select("videoRatio").where("id", input.projectId).first();
  const videoPath = `/${input.projectId}/video/${uuid()}.mp4`;
  const [videoId] = await u.db("o_video").insert({
    filePath: videoPath,
    time: Date.now(),
    state: "排队中",
    scriptId: input.scriptId,
    projectId: input.projectId,
    videoTrackId: input.trackId,
  });
  const [legacyTaskId] = await u.db("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "视频生成",
    relatedObjects: JSON.stringify({ projectId: input.projectId, videoId, scriptId: input.scriptId, type: "视频" }),
    model: input.model.split(/:(.+)/)[1] ?? input.model,
    describe: "持久队列：根据提示词生成视频",
    state: "排队中",
    startTime: Date.now(),
  });
  const payload: VideoGenerationTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    trackId: input.trackId,
    videoId,
    videoPath,
    uploadData: input.uploadData,
    prompt: input.prompt,
    duration: input.duration,
    model: input.model,
    mode: input.mode,
    resolution: input.resolution,
    audio: input.audio,
    aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
  };
  const result = await generationTaskRepository.enqueue({
    projectId: input.projectId,
    legacyTaskId,
    lane: "video",
    type: "video.generate",
    resourceKey,
    payload,
    provider: input.model.split(/:(.+)/)[0],
    idempotencyKey,
    maxAttempts: 3,
  });
  if (result.deduped) {
    await u.db("o_video").where("id", videoId).delete();
    await u.db("o_tasks").where("id", legacyTaskId).delete();
    const existingPayload = result.task.payload as VideoGenerationTaskPayload;
    return { task: result.task, videoId: existingPayload.videoId, deduped: true };
  }
  return { task: result.task, videoId, deduped: false };
}
