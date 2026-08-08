import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { voiceStudioRepository } from "@/services/voice-studio/repository";
import { enqueueUtteranceTts } from "@/services/task-engine/enqueueUtteranceTts";
import { db } from "@/utils/db";

const router = express.Router();
const utteranceKinds = ["dialogue", "narration", "chorus"] as const;

router.post(
  "/import",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    includeStoryboardDescriptions: z.boolean().optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.importScript(req.body)));
  },
);

router.post(
  "/list",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive().optional(),
    storyboardId: z.number().int().positive().optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.listUtterances(req.body)));
  },
);

router.post(
  "/update",
  validateFields({
    id: z.string().uuid(),
    projectId: z.number().int().positive(),
    speaker: z.string().trim().min(1).max(80).optional(),
    text: z.string().trim().min(1).optional(),
    kind: z.enum(utteranceKinds).optional(),
    roleAssetId: z.number().int().positive().nullable().optional(),
    voiceCastId: z.string().uuid().nullable().optional(),
    durationMs: z.number().int().positive().nullable().optional(),
    locked: z.boolean().optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await voiceStudioRepository.updateUtterance(req.body)));
  },
);

router.post(
  "/generate",
  validateFields({
    projectId: z.number().int().positive(),
    utteranceId: z.string().uuid(),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await enqueueUtteranceTts(req.body)));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

router.post(
  "/batchGenerate",
  validateFields({
    projectId: z.number().int().positive(),
    utteranceIds: z.array(z.string().uuid()).min(1).max(500),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    try {
      const rows = await (db as any)("utterances")
        .where("project_id", req.body.projectId)
        .whereIn("id", req.body.utteranceIds)
        .select("id", "speaker", "voice_cast_id");
      if (rows.length !== req.body.utteranceIds.length) throw new Error("部分台词不存在或不属于当前项目");
      const missingCast = rows.filter((row: any) => !row.voice_cast_id);
      if (missingCast.length) {
        throw new Error(`请先为这些台词分配音色：${missingCast.map((row: any) => row.speaker).join("、")}`);
      }
      const data = [];
      for (const [index, utteranceId] of req.body.utteranceIds.entries()) {
        data.push(await enqueueUtteranceTts({
          projectId: req.body.projectId,
          utteranceId,
          requestId: `${req.body.requestId}:${index}`,
        }));
      }
      res.status(200).send(success(data));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);

export default router;
