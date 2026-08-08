import { v4 as uuid } from "uuid";
import u from "@/utils";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { AssetImageTaskPayload, StoryboardImageTaskPayload } from "@/services/task-engine/handlers/imageGeneration";
import { prepareCostReservation } from "@/services/task-engine/budget";

const terminal = new Set(["cancelled", "succeeded", "failed"]);

async function activeTask(projectId: number, type: string, resourceKey: string) {
  const tasks = await generationTaskRepository.list({ projectId, type, limit: 100 });
  return tasks.data.find((task) => task.resourceKey === resourceKey && !terminal.has(task.status));
}

export async function enqueueAssetImageGeneration(input: {
  projectId: number;
  scriptId: number;
  assetId: number;
  assetType: "role" | "tool" | "scene";
  describe: string;
  parentDescribe?: string;
  parentImagePath?: string;
  model: `${string}:${string}`;
  size: "1K" | "2K" | "4K";
  requestId: string;
}) {
  const resourceKey = `image:asset:${input.assetId}`;
  const existing = await activeTask(input.projectId, "asset.image.generate", resourceKey);
  if (existing) return { task: existing, payload: existing.payload as AssetImageTaskPayload, deduped: true };
  const costReservation = await prepareCostReservation({
    projectId: input.projectId,
    lane: "image",
    model: input.model,
    metrics: { request: 1 },
  });

  const savePath = `/${input.projectId}/assets/${input.scriptId}/${input.assetType}/${uuid()}.jpg`;
  const [imageId] = await u.db("o_image").insert({
    assetsId: input.assetId,
    type: input.assetType,
    state: "生成中",
    resolution: input.size,
    model: input.model,
  });
  await u.db("o_assets").where("id", input.assetId).update({ imageId });
  const [legacyTaskId] = await u.db("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "生成图片",
    relatedObjects: JSON.stringify({ assetId: input.assetId, imageId }),
    model: input.model.split(/:(.+)/)[1] ?? input.model,
    describe: "持久队列：资产图片生成",
    state: "排队中",
    startTime: Date.now(),
  });
  const payload: AssetImageTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    assetId: input.assetId,
    imageId,
    assetType: input.assetType,
    describe: input.describe,
    parentDescribe: input.parentDescribe,
    parentImagePath: input.parentImagePath,
    model: input.model,
    size: input.size,
    aspectRatio: "16:9",
    savePath,
  };
  const result = await generationTaskRepository.enqueue({
    projectId: input.projectId,
    legacyTaskId,
    lane: "image",
    type: "asset.image.generate",
    resourceKey,
    payload,
    provider: input.model.split(/:(.+)/)[0],
    idempotencyKey: stableIdempotencyKey({ requestId: input.requestId, resourceKey, type: "asset.image.generate" }),
    maxAttempts: 3,
    costReservation,
  });
  if (result.deduped) {
    await u.db("o_image").where("id", imageId).delete();
    await u.db("o_tasks").where("id", legacyTaskId).delete();
    const existingPayload = result.task.payload as AssetImageTaskPayload;
    await u.db("o_assets").where("id", input.assetId).update({ imageId: existingPayload.imageId });
    return { task: result.task, payload: existingPayload, deduped: true };
  }
  return { task: result.task, payload, deduped: false };
}

export async function enqueueStoryboardImageGeneration(input: {
  projectId: number;
  scriptId: number;
  storyboardId: number;
  prompt: string;
  referenceImageIds: number[];
  model: `${string}:${string}`;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  requestId: string;
}) {
  const resourceKey = `image:storyboard:${input.storyboardId}`;
  const existing = await activeTask(input.projectId, "storyboard.image.generate", resourceKey);
  if (existing) return { task: existing, payload: existing.payload as StoryboardImageTaskPayload, deduped: true };
  const costReservation = await prepareCostReservation({
    projectId: input.projectId,
    lane: "image",
    model: input.model,
    metrics: { request: 1 },
  });

  const [legacyTaskId] = await u.db("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "生成分镜图片",
    relatedObjects: JSON.stringify({ storyboardId: input.storyboardId }),
    model: input.model.split(/:(.+)/)[1] ?? input.model,
    describe: "持久队列：分镜图片生成",
    state: "排队中",
    startTime: Date.now(),
  });
  const payload: StoryboardImageTaskPayload = {
    projectId: input.projectId,
    scriptId: input.scriptId,
    storyboardId: input.storyboardId,
    prompt: input.prompt,
    referenceImageIds: input.referenceImageIds,
    model: input.model,
    size: input.size,
    aspectRatio: input.aspectRatio,
    savePath: `/${input.projectId}/assets/${input.scriptId}/${uuid()}.jpg`,
  };
  const result = await generationTaskRepository.enqueue({
    projectId: input.projectId,
    legacyTaskId,
    lane: "image",
    type: "storyboard.image.generate",
    resourceKey,
    payload,
    provider: input.model.split(/:(.+)/)[0],
    idempotencyKey: stableIdempotencyKey({ requestId: input.requestId, resourceKey, type: "storyboard.image.generate" }),
    maxAttempts: 3,
    costReservation,
  });
  if (result.deduped) await u.db("o_tasks").where("id", legacyTaskId).delete();
  return { task: result.task, payload: result.task.payload as StoryboardImageTaskPayload, deduped: result.deduped };
}
