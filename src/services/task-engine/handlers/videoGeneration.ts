import u from "@/utils";
import { GenerationTask, TaskExecutionError } from "@/domain/generationTask";
import { ReferenceList } from "@/utils/ai";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";

export interface VideoGenerationTaskPayload {
  projectId: number;
  scriptId: number;
  trackId: number;
  videoId: number;
  videoPath: string;
  uploadData: Array<{ id: number; sources: string }>;
  prompt: string;
  duration: number;
  model: `${string}:${string}`;
  mode: string | string[];
  resolution: string;
  audio?: boolean;
  aspectRatio: "16:9" | "9:16";
}

async function loadReferences(payload: VideoGenerationTaskPayload): Promise<ReferenceList[]> {
  const references = await Promise.all(
    payload.uploadData.map(async (item) => {
      if (item.sources === "storyboard") {
        const image = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
        if (!image?.filePath) throw new TaskExecutionError(`分镜图不存在: ${item.id}`, "STORYBOARD_IMAGE_MISSING", false);
        return { path: image.filePath, type: "image" as const };
      }
      if (item.sources === "assets") {
        const asset = await u
          .db("o_assets")
          .where("o_assets.id", item.id)
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .select("o_image.filePath", "o_image.type")
          .first();
        if (!asset?.filePath) throw new TaskExecutionError(`资产引用不存在或没有图片: ${item.id}`, "ASSET_IMAGE_MISSING", false);
        return { path: asset.filePath, type: asset.type === "audio" ? ("audio" as const) : ("image" as const) };
      }
      throw new TaskExecutionError(`不支持的引用来源: ${item.sources}`, "REFERENCE_SOURCE_INVALID", false);
    }),
  );
  return Promise.all(
    references.map(async (reference) => ({
      base64: await u.oss.getImageBase64(reference.path),
      type: reference.type,
    })),
  );
}

export const videoGenerationTaskHandler: TaskHandler = {
  async execute(task: GenerationTask, context: TaskHandlerContext): Promise<unknown> {
    const payload = task.payload as VideoGenerationTaskPayload;
    const references = await loadReferences(payload);
    await context.throwIfCancelled();
    const aiVideo = u.Ai.Video(payload.model);
    await context.transitionToSubmitting();
    try {
      await aiVideo.run({
        prompt: payload.prompt,
        referenceList: references,
        mode: payload.mode as any,
        duration: payload.duration,
        aspectRatio: payload.aspectRatio,
        resolution: payload.resolution,
        audio: payload.audio,
      });
      await context.transitionToFinalizing();
      await aiVideo.save(payload.videoPath);
      await u.db("o_video").where("id", payload.videoId).update({ state: "生成成功", errorReason: null });
      return { videoId: payload.videoId, videoPath: payload.videoPath };
    } catch (error) {
      const message = u.error(error).message;
      await u.db("o_video").where("id", payload.videoId).update({
        state: "需人工确认",
        errorReason: `${message}。请先核对供应商后台，避免重复提交。`,
      });
      throw error;
    }
  },
};
