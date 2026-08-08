import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success } from "@/lib/responseFormat";
import { generationTaskLanes, generationTaskStatuses } from "@/domain/generationTask";
import { generationTaskRepository } from "@/services/task-engine/repository";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().optional(),
    lane: z.enum(generationTaskLanes).optional(),
    status: z.enum(generationTaskStatuses).optional(),
    type: z.string().optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  async (req, res) => {
    res.status(200).send(success(await generationTaskRepository.list(req.body)));
  },
);
