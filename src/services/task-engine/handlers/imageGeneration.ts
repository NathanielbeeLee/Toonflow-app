import u from "@/utils";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";

interface BaseImagePayload {
  projectId: number;
  scriptId: number;
  model: `${string}:${string}`;
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
  savePath: string;
}

export interface AssetImageTaskPayload extends BaseImagePayload {
  assetId: number;
  imageId: number;
  assetType: "role" | "tool" | "scene";
  describe: string;
  parentDescribe?: string;
  parentImagePath?: string;
}

export interface StoryboardImageTaskPayload extends BaseImagePayload {
  storyboardId: number;
  prompt: string;
  referenceImageIds: number[];
}

async function generateAndSave(
  payload: BaseImagePayload,
  prompt: string,
  references: Array<{ type: "image"; base64: string }>,
  context: TaskHandlerContext,
  beginSubmitting = true,
) {
  await context.throwIfCancelled();
  if (beginSubmitting) await context.transitionToSubmitting();
  const image = await u.Ai.Image(payload.model).run({
    prompt,
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
}

export const assetImageTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as AssetImageTaskPayload;
    const artPromptType = {
      role: "art_character_derivative",
      tool: "art_prop_derivative",
      scene: "art_scene_derivative",
    }[payload.assetType];
    const project = await u.db("o_project").where("id", payload.projectId).select("artStyle").first();
    const system = u.getArtPrompt(project?.artStyle || "", "art_skills", artPromptType);
    await context.throwIfCancelled();
    await context.transitionToSubmitting();
    const { text } = await u.Ai.Text("universalAi").invoke({
      system,
      messages: [
        {
          role: "user",
          content: `父级资产描述: ${payload.parentDescribe || "无详细描述"}\n当前资产描述: ${payload.describe || "无详细描述"}`,
        },
      ],
    });
    await u.db("o_assets").where("id", payload.assetId).update({ prompt: text });
    const references = payload.parentImagePath
      ? [{ type: "image" as const, base64: await u.oss.getImageBase64(payload.parentImagePath) }]
      : [];
    await generateAndSave(payload, text, references, context, false);
    await u.db("o_image").where("id", payload.imageId).update({ state: "已完成", filePath: payload.savePath, errorReason: null });
    return { assetId: payload.assetId, imageId: payload.imageId, imagePath: payload.savePath };
  },
};

export const storyboardImageTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext) {
    const payload = task.payload as StoryboardImageTaskPayload;
    const rows = payload.referenceImageIds.length
      ? await u.db("o_image").whereIn("id", payload.referenceImageIds).select("id", "filePath")
      : [];
    const pathById = new Map<number, string>();
    rows.forEach((row) => {
      if (typeof row.id === "number" && row.filePath) pathById.set(row.id, row.filePath);
    });
    const references = (
      await Promise.all(
        payload.referenceImageIds.map(async (id) => {
          const filePath = pathById.get(id);
          if (!filePath) return null;
          try {
            return { type: "image" as const, base64: await u.oss.getImageBase64(filePath) };
          } catch {
            return null;
          }
        }),
      )
    ).filter((item): item is { type: "image"; base64: string } => item !== null);
    await generateAndSave(payload, payload.prompt, references, context);
    await u.db("o_storyboard").where("id", payload.storyboardId).update({
      filePath: payload.savePath,
      state: "已完成",
      reason: null,
    });
    return { storyboardId: payload.storyboardId, imagePath: payload.savePath };
  },
};
