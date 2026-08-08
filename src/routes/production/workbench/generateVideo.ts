import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueVideoGeneration } from "@/services/task-engine/enqueueVideo";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    uploadData: z.array(z.object({ id: z.number(), sources: z.string() })),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    audio: z.boolean().optional(),
    trackId: z.number(),
    requestId: z.string().optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId, requestId = uuid() } = req.body;
    let effectiveMode: string | string[] = mode;
    if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        effectiveMode = JSON.parse(mode);
      } catch {
        effectiveMode = mode;
      }
    }

    const queued = await enqueueVideoGeneration({
      projectId,
      scriptId,
      trackId,
      uploadData,
      prompt,
      duration,
      model: model as `${string}:${string}`,
      mode: effectiveMode,
      resolution,
      audio,
      requestId,
    });

    // 保持原接口契约：前端仍直接拿到 videoId。
    res.status(200).send(success(queued.videoId));
  },
);
