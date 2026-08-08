import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { voiceStudioRepository } from "@/services/voice-studio/repository";

const router = express.Router();
const filters = {
  projectId: z.number().int().positive(),
  scriptId: z.number().int().positive().optional(),
};

router.post("/list", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await voiceStudioRepository.listCues(req.body)));
});

router.post("/rebuild", validateFields(filters), async (req, res) => {
  res.status(200).send(success(await voiceStudioRepository.rebuildCues(req.body)));
});

router.post(
  "/update",
  validateFields({
    id: z.string().uuid(),
    projectId: z.number().int().positive(),
    startMs: z.number().int().min(0).optional(),
    endMs: z.number().int().positive().optional(),
    text: z.string().trim().min(1).optional(),
    style: z.record(z.string(), z.unknown()).nullable().optional(),
    locked: z.boolean().optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.updateCue(req.body)));
  },
);

router.post(
  "/export",
  validateFields({ ...filters, format: z.enum(["srt", "vtt"]) }),
  async (req, res) => {
    const content = await voiceStudioRepository.exportSubtitles(req.body);
    res.status(200).send(success({ format: req.body.format, content }));
  },
);

export default router;
