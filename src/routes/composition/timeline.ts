import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildNormalizedTimeline, getLatestTimeline, listTimelines } from "@/services/composition/timeline";
import { enqueueCompositionRender, getLatestCompositionJob } from "@/services/composition/jobs";
import { compositionRenderPresets } from "@/services/composition/renderer";
import {
  deleteProjectAudioClip,
  listProjectAudioClips,
  projectAudioKinds,
  upsertProjectAudioClip,
} from "@/services/composition/audioClips";
import { enqueueCompositionQa, getLatestQaReport } from "@/services/composition/qaJobs";

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

router.post("/audio/list", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await listProjectAudioClips(req.body)));
});

router.post("/qa/latest", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await getLatestQaReport(req.body)));
});

router.post(
  "/qa/run",
  validateFields({
    ...filters,
    compositionJobId: z.string().uuid(),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await enqueueCompositionQa(req.body)));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

router.post(
  "/audio/upsert",
  validateFields({
    ...filters,
    id: z.string().uuid().optional(),
    kind: z.enum(projectAudioKinds),
    assetId: z.number().int().positive(),
    startMs: z.number().int().nonnegative(),
    inMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive().optional(),
    gainDb: z.number().min(-60).max(24),
    fadeInMs: z.number().int().nonnegative().max(60_000),
    fadeOutMs: z.number().int().nonnegative().max(60_000),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await upsertProjectAudioClip(req.body)));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

router.post(
  "/audio/delete",
  validateFields({ ...filters, id: z.string().uuid() }),
  async (req, res) => {
    try {
      res.status(200).send(success(await deleteProjectAudioClip(req.body)));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

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
