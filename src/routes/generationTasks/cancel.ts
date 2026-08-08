import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { success } from "@/lib/responseFormat";
import { generationTaskRepository } from "@/services/task-engine/repository";

const router = express.Router();

export default router.post("/", validateFields({ taskId: z.string().uuid() }), async (req, res) => {
  const task = await generationTaskRepository.requestCancel(req.body.taskId);
  if (!task) return res.status(404).send({ message: "任务不存在" });
  return res.status(200).send(success(task));
});
