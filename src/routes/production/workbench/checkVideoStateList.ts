import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { getVideoPresentation } from "@/services/media/videoPoster";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    videoIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, scriptId, videoIds } = req.body;
    const videoList = await u
      .db("o_video")
      .whereIn("id", videoIds)
      .whereIn("state", ["生成成功", "生成失败", "需人工确认", "已取消", "已阻塞"])
      .select("id", "state", "errorReason", "filePath");
    res.status(200).send(
      success(
        await Promise.all(
          videoList.map(async (s) => ({
            ...s,
            state: s.state === "生成成功" || s.state === "已完成" ? "已完成" : s.state,
            ...(s.filePath ? await getVideoPresentation(s.filePath) : { src: "", posterSrc: "" }),
          })),
        ),
      ),
    );
  },
);
