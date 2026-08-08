import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueScriptAssetExtraction } from "@/services/script-assets/extraction";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number().int().positive()).min(1).max(5_000),
    projectId: z.number().int().positive(),
    groupSize: z.number().int().min(1).max(20).optional(),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    try {
      res.status(200).send(success(await enqueueScriptAssetExtraction({ ...req.body, groupSize: req.body.groupSize ?? 5 })));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : String(cause)));
    }
  },
);
