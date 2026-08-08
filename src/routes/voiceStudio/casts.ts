import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { voiceStudioRepository } from "@/services/voice-studio/repository";

const router = express.Router();

router.post(
  "/list",
  validateFields({ projectId: z.number().int().positive() }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.listVoiceCasts(req.body.projectId)));
  },
);

router.post(
  "/upsert",
  validateFields({
    id: z.string().uuid().optional(),
    projectId: z.number().int().positive(),
    roleAssetId: z.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1).max(80),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    voice: z.string().trim().min(1),
    speechRate: z.number().min(0.25).max(4).optional(),
    pitchRate: z.number().min(-12).max(12).optional(),
    volume: z.number().min(0).max(4).optional(),
    emotion: z.string().trim().max(80).nullable().optional(),
    isDefault: z.boolean().optional(),
    previewAssetId: z.number().int().positive().nullable().optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.upsertVoiceCast(req.body)));
  },
);

export default router;
