import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildNormalizedTimeline, getLatestTimeline, listTimelines } from "@/services/composition/timeline";

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

export default router;
