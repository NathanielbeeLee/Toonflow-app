import u from "@/utils";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";

export interface WorkflowImageTaskPayload {
  projectId: number;
  model: `${string}:${string}`;
  prompt: string;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  referencePaths: string[];
  savePath: string;
}

export const workflowImageTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as WorkflowImageTaskPayload;
    const references = await Promise.all(payload.referencePaths.map(async (filePath) => ({
      type: "image" as const,
      base64: await u.oss.getImageBase64(filePath),
    })));
    await context.throwIfCancelled();
    await context.transitionToSubmitting();
    const image = await u.Ai.Image(payload.model).run({ prompt: payload.prompt, referenceList: references, size: payload.size, aspectRatio: payload.aspectRatio });
    await context.transitionToFinalizing();
    try {
      await image.save(payload.savePath);
    } catch (error) {
      throw new TaskExecutionError(u.error(error).message, "IMAGE_SAVE_FAILED", false, true);
    }
    return { imagePath: payload.savePath, imageUrl: await u.oss.getSmallImageUrl(payload.savePath) };
  },
};
