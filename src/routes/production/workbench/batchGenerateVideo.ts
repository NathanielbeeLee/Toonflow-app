import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueVideoGeneration } from "@/services/task-engine/enqueueVideo";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackData: z.array(
      z.object({
        uploadData: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
        trackId: z.number(),
        prompt: z.string(),
        duration: z.number(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    audio: z.boolean().optional(),
    requestId: z.string().optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, trackData, model, resolution, audio, mode, requestId = uuidv4() } = req.body;

    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }

    const tasks = await Promise.all(
      (trackData as { uploadData: { id: number; sources: string }[]; trackId: number; prompt: string; duration: number }[]).map(
        async ({ uploadData, trackId, prompt, duration }) => {
          const queued = await enqueueVideoGeneration({
            projectId,
            scriptId,
            trackId,
            uploadData,
            prompt,
            duration,
            model: model as `${string}:${string}`,
            mode: modeData.length > 0 ? modeData : mode,
            resolution,
            audio,
            requestId: `${requestId}:${trackId}`,
          });
          return {
            videoId: queued.videoId,
            trackId,
            durableTaskId: queued.task.id,
            deduped: queued.deduped,
          };
        },
      ),
    );

    res.status(200).send(success(tasks));
  },
);
