import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { inspectVideoGenerationBatchReadiness } from "@/services/video-readiness";

const router = express.Router();
const trackSchema = z.object({
  uploadData: z.array(z.object({ id: z.number(), sources: z.string() })),
  trackId: z.number(),
  prompt: z.string(),
  duration: z.number(),
});

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackData: z.array(trackSchema).min(1),
    model: z.string(),
    mode: z.union([z.string(), z.array(z.string())]),
    resolution: z.string(),
  }),
  async (req, res) => {
    const { projectId, scriptId, trackData, model, mode, resolution } = req.body;
    const tracks = await inspectVideoGenerationBatchReadiness(
      trackData.map((track: z.infer<typeof trackSchema>) => ({
        projectId,
        scriptId,
        ...track,
        model,
        mode,
        resolution,
      })),
    );
    res.status(200).send(success({ ready: tracks.every((track) => track.ready), tracks }));
  },
);
