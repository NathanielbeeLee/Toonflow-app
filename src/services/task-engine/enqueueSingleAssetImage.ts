import { v4 as uuid } from "uuid";
import u from "@/utils";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";
import { prepareCostReservation } from "@/services/task-engine/budget";
import { SingleAssetImageTaskPayload } from "@/services/task-engine/handlers/singleAssetImage";

export async function enqueueSingleAssetImage(input: {
  projectId: number;
  assetId: number;
  assetType: "role" | "scene" | "tool";
  model: `${string}:${string}`;
  prompt: string;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  referenceBase64?: string;
  requestId: string;
}) {
  const resourceKey = `image:asset:${input.assetId}`;
  const existing = await generationTaskRepository.list({ projectId: input.projectId, lane: "image", limit: 100 });
  const active = existing.data.find((task) => task.resourceKey === resourceKey && !["cancelled", "succeeded", "failed"].includes(task.status));
  if (active) return { task: active, payload: active.payload, deduped: true };
  const asset = await u.db("o_assets").where({ id: input.assetId, projectId: input.projectId }).first();
  if (!asset) throw new Error("资产不存在或不属于当前项目");
  const costReservation = await prepareCostReservation({ projectId: input.projectId, lane: "image", model: input.model, metrics: { request: 1 } });
  let referencePath: string | undefined;
  if (input.referenceBase64) {
    referencePath = `/${input.projectId}/task-inputs/${uuid()}.png`;
    await u.oss.writeFile(referencePath, input.referenceBase64);
  }
  let imageId: number | undefined;
  let legacyTaskId: number | undefined;
  try {
    [imageId] = await u.db("o_image").insert({
      type: input.assetType,
      state: "生成中",
      assetsId: input.assetId,
      model: input.model.split(/:(.+)/)[1] ?? input.model,
      resolution: input.size,
    });
    if (imageId == null) throw new Error("创建图片占位记录失败");
    await u.db("o_assets").where("id", input.assetId).update({ imageId });
    [legacyTaskId] = await u.db("o_tasks").insert({
      projectId: input.projectId,
      taskClass: "单张资产图片",
      relatedObjects: JSON.stringify({ assetId: input.assetId, imageId }),
      model: input.model.split(/:(.+)/)[1] ?? input.model,
      describe: "持久队列：单张资产图片生成",
      state: "排队中",
      startTime: Date.now(),
    });
    if (legacyTaskId == null) throw new Error("创建图片任务记录失败");
    const payload: SingleAssetImageTaskPayload = {
      projectId: input.projectId,
      assetId: input.assetId,
      imageId,
      assetType: input.assetType,
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      aspectRatio: input.aspectRatio,
      savePath: `/${input.projectId}/assets/single/${uuid()}.jpg`,
      referencePath,
    };
    const queued = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "image",
      type: "asset.image.single.generate",
      resourceKey,
      payload,
      provider: input.model.split(/:(.+)/)[0],
      idempotencyKey: stableIdempotencyKey({ type: "asset.image.single.generate", resourceKey, requestId: input.requestId }),
      maxAttempts: 3,
      costReservation,
    });
    if (queued.deduped) {
      await Promise.all([u.db("o_image").where("id", imageId).delete(), u.db("o_tasks").where("id", legacyTaskId).delete()]);
      if (referencePath) await u.oss.deleteFile(referencePath).catch(() => undefined);
      const existingPayload = queued.task.payload as SingleAssetImageTaskPayload;
      await u.db("o_assets").where("id", input.assetId).update({ imageId: existingPayload.imageId });
      return { task: queued.task, payload: existingPayload, deduped: true };
    }
    return { task: queued.task, payload, deduped: false };
  } catch (error) {
    const cleanup: Promise<unknown>[] = [u.db("o_assets").where("id", input.assetId).update({ imageId: asset.imageId ?? null })];
    if (imageId) cleanup.push(u.db("o_image").where("id", imageId).delete());
    if (legacyTaskId) cleanup.push(u.db("o_tasks").where("id", legacyTaskId).delete());
    await Promise.all(cleanup);
    if (referencePath) await u.oss.deleteFile(referencePath).catch(() => undefined);
    throw error;
  }
}
