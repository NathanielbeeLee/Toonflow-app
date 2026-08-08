import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildNormalizedTimeline, getLatestTimeline, listTimelines } from "@/services/composition/timeline";
import { enqueueCompositionRender, getLatestCompositionJob } from "@/services/composition/jobs";
import { compositionRenderPresets } from "@/services/composition/renderer";

const router = express.Router();
const filters = {
  projectId: z.number().int().positive(),
  scriptId: z.number().int().positive(),
};

router.post("/build", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await buildNormalizedTimeline(req.body)));
});

router.post("/latest", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await getLatestTimeline(req.body)));
});

router.post("/list", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await listTimelines(req.body)));
});

router.post("/jobs/latest", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await getLatestCompositionJob(req.body)));
});

router.post(
  "/render",
  validateFields({
    ...filters,
    timelineId: z.string().uuid(),
    preset: z.enum(compositionRenderPresets),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await enqueueCompositionRender(req.body)));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

export default router;
