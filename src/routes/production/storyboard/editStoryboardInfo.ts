import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeActionBeats, serializeActionBeats } from "@/services/storyboard/actionBeats";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
    actionBeats: z.array(z.string()).optional(),
    actionBeatsConfirmed: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc, actionBeats, actionBeatsConfirmed } = req.body;
    const existing = await u.db("o_storyboard").where({ id }).select("actionBeats", "actionBeatsConfirmed").first();
    if (!existing) return res.status(404).send(error("分镜不存在"));

    const normalizedActionBeats = normalizeActionBeats(actionBeats === undefined ? existing.actionBeats : actionBeats);
    const confirmed = actionBeatsConfirmed === undefined ? Boolean(existing.actionBeatsConfirmed) : Boolean(actionBeatsConfirmed);
    if (confirmed && normalizedActionBeats.length === 0) return res.status(400).send(error("确认前请至少填写一条动作拍点"));

    await u.db("o_storyboard").where({ id }).update({
      prompt,
      videoDesc,
      actionBeats: serializeActionBeats(normalizedActionBeats),
      actionBeatsConfirmed: confirmed ? 1 : 0,
    });
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
