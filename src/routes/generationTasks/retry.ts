import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success } from "@/lib/responseFormat";
import { generationTaskRepository } from "@/services/task-engine/repository";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ taskId: z.string().uuid(), confirmUnknownProviderState: z.boolean().optional() }),
  async (req, res) => {
    try {
      const task = await generationTaskRepository.retry(req.body.taskId, req.body.confirmUnknownProviderState === true);
      return res.status(200).send(success(task));
    } catch (error) {
      return res.status(409).send({ message: error instanceof Error ? error.message : String(error) });
    }
  },
);
