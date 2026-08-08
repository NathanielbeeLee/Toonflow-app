import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueWorkflowImage } from "@/services/task-engine/enqueueWorkflowImage";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.array(z.string()).optional(),
    quality: z.enum(["1K", "2K", "4K"]),
    ratio: z.string().regex(/^\d+:\d+$/),
    prompt: z.string(),
    projectId: z.number(),
    nodeId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
  }),
  async (req, res) => {
    const { model, references = [], quality, ratio, prompt, projectId } = req.body;
    try {
      const result = await enqueueWorkflowImage({
        projectId,
        nodeId: req.body.nodeId,
        model: model as `${string}:${string}`,
        prompt,
        size: quality,
        aspectRatio: ratio as `${number}:${number}`,
        referencePaths: references.map((url: string) => u.replaceUrl(url)).filter(Boolean),
        requestId: req.body.requestId,
      });
      return res.status(200).send(success({ taskId: result.task.id, deduped: result.deduped, queued: true }));
    } catch (e) {
      res.status(400).send(error(u.error(e).message));
    }
  },
);
