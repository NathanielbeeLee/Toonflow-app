import u from "@/utils";
import { GenerationTask, TaskCancelledError, TaskExecutionError } from "@/domain/generationTask";
import { ReferenceList } from "@/utils/ai";
import { TaskHandler, TaskHandlerContext } from "@/services/task-engine/worker";
import { ensureVideoPoster } from "@/services/media/videoPoster";

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
    let providerJobId = task.providerJobId;
    try {
      const input = {
        prompt: payload.prompt,
        referenceList: references,
        mode: payload.mode as any,
        duration: payload.duration,
        aspectRatio: payload.aspectRatio,
        resolution: payload.resolution,
        audio: payload.audio,
      };
      const resumable = await aiVideo.supportsResumable();
      if (providerJobId && !resumable) {
        throw new TaskExecutionError("已保存远端任务 ID，但当前供应商代码不再支持恢复轮询", "PROVIDER_RESUME_UNAVAILABLE", false);
      }

      if (resumable) {
        if (!providerJobId) {
          await context.transitionToSubmitting();
          const submitted = await aiVideo.submit(input);
          providerJobId = submitted.jobId;
          await context.persistProviderJobId(providerJobId);
        }
        await context.transitionToPolling();
        const startedAt = Date.now();
        let providerSucceeded = false;
        while (Date.now() - startedAt < 30 * 60 * 1000) {
          await context.throwIfCancelled();
          let polled;
          try {
            polled = await aiVideo.poll(providerJobId);
          } catch (error) {
            throw new TaskExecutionError(u.error(error).message, "PROVIDER_POLL_FAILED", true);
          }
          if (polled.status === "succeeded") {
            providerSucceeded = true;
            break;
          }
          if (polled.status === "failed") {
            throw new TaskExecutionError(polled.error || "供应商视频任务失败", "PROVIDER_JOB_FAILED", false, true);
          }
          if (polled.status === "cancelled") throw new TaskCancelledError("供应商视频任务已取消");
          await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
        if (!providerSucceeded) {
          throw new TaskExecutionError("供应商任务轮询超过 30 分钟，将稍后继续查询", "PROVIDER_POLL_TIMEOUT", true);
        }
      } else {
        await context.transitionToSubmitting();
        await aiVideo.run(input);
      }

      await context.transitionToFinalizing();
      try {
        await aiVideo.save(payload.videoPath);
      } catch (error) {
        throw new TaskExecutionError(u.error(error).message, "VIDEO_SAVE_FAILED", Boolean(providerJobId), Boolean(providerJobId));
      }
      await u.db("o_video").where("id", payload.videoId).update({ state: "生成成功", errorReason: null });
      void ensureVideoPoster(payload.videoPath);
      return { videoId: payload.videoId, videoPath: payload.videoPath, providerJobId };
    } catch (error) {
      if (error instanceof TaskCancelledError && providerJobId) {
        try {
          await aiVideo.cancel(providerJobId);
        } catch (cancelError) {
          console.warn("[供应商远端取消失败]", u.error(cancelError).message);
        }
      }
      throw error;
    }
  },
};
