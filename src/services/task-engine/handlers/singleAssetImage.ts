import u from "@/utils";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";

export interface SingleAssetImageTaskPayload {
  projectId: number;
  assetId: number;
  imageId: number;
  assetType: "role" | "scene" | "tool";
  model: `${string}:${string}`;
  prompt: string;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  savePath: string;
  referencePath?: string;
}

export const singleAssetImageTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as SingleAssetImageTaskPayload;
    const asset = await u.db("o_assets").where({ id: payload.assetId, projectId: payload.projectId }).first();
    if (!asset) throw new TaskExecutionError("资产不存在或不属于当前项目", "ASSET_NOT_FOUND", false, true);
    const references = payload.referencePath
      ? [{ type: "image" as const, base64: await u.oss.getImageBase64(payload.referencePath) }]
      : [];
    await context.throwIfCancelled();
    await context.transitionToSubmitting();
    const image = await u.Ai.Image(payload.model).run({
      prompt: payload.prompt,
      referenceList: references,
      size: payload.size,
      aspectRatio: payload.aspectRatio,
    });
    await context.transitionToFinalizing();
    try {
      await image.save(payload.savePath);
    } catch (error) {
      throw new TaskExecutionError(u.error(error).message, "IMAGE_SAVE_FAILED", false, true);
    }
    await u.db("o_image").where("id", payload.imageId).update({
      state: "已完成",
      filePath: payload.savePath,
      type: payload.assetType,
      model: payload.model.split(/:(.+)/)[1] ?? payload.model,
      resolution: payload.size,
      errorReason: null,
    });
    await u.db("o_assets").where("id", payload.assetId).update({ imageId: payload.imageId });
    if (payload.referencePath) await u.oss.deleteFile(payload.referencePath).catch(() => undefined);
    return { assetId: payload.assetId, imageId: payload.imageId, imagePath: payload.savePath };
  },
};
