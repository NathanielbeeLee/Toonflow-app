import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueStoryboardImageGeneration } from "@/services/task-engine/enqueueImage";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    storyboardIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
    compulsory: z.boolean().optional(),
    requestId: z.string().optional(),
  }),
  async (req, res) => {
    const { storyboardIds, projectId, scriptId, compulsory = false, requestId = uuid() } = req.body;
    if (!storyboardIds.length) return res.status(400).send(error("storyboardIds不能为空"));

    const storyboardData = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyboardIds);
    if (!storyboardData.length) return res.status(404).send(error("未查到分镜数据"));
    const storyIds = storyboardData.map((item) => item.id).filter((id): id is number => typeof id === "number");
    if (compulsory) {
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).update({ state: "生成中", shouldGenerateImage: 1 });
    } else {
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).where("shouldGenerateImage", 0).update({ state: "未生成" });
      await u.db("o_storyboard").whereIn("id", storyIds).where("scriptId", scriptId).where("shouldGenerateImage", 1).update({ state: "生成中" });
    }

    const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality", "videoRatio").first();
    if (!project?.imageModel) return res.status(400).send(error("项目未配置图片模型"));

    const links = await u.db("o_assets2Storyboard").whereIn("storyboardId", storyIds).orderBy("rowid").select("storyboardId", "assetId");
    const assetIds = [...new Set(links.map((row) => row.assetId).filter((id): id is number => typeof id === "number"))];
    const assetImageMap = new Map<number, number>();
    if (assetIds.length) {
      const rows = await u.db("o_assets").whereIn("id", assetIds).select("id", "imageId");
      rows.forEach((row) => {
        if (typeof row.id === "number" && typeof row.imageId === "number") assetImageMap.set(row.id, row.imageId);
      });
    }
    const referenceMap = new Map<number, number[]>();
    links.forEach((row) => {
      if (typeof row.storyboardId !== "number" || typeof row.assetId !== "number") return;
      const imageId = assetImageMap.get(row.assetId);
      if (imageId == null) return;
      const list = referenceMap.get(row.storyboardId) || [];
      list.push(imageId);
      referenceMap.set(row.storyboardId, list);
    });

    const generateList = compulsory ? storyboardData : storyboardData.filter((item) => item.shouldGenerateImage !== 0);
    await Promise.all(
      generateList.filter((item) => typeof item.id === "number").map((item) =>
        enqueueStoryboardImageGeneration({
          projectId,
          scriptId,
          storyboardId: item.id!,
          prompt: item.prompt || "",
          referenceImageIds: referenceMap.get(item.id!) || [],
          model: project.imageModel as `${string}:${string}`,
          size: (project.imageQuality || "1K") as "1K" | "2K" | "4K",
          aspectRatio: (project.videoRatio || "16:9") as `${number}:${number}`,
          requestId: `${requestId}:${item.id!}`,
        }),
      ),
    );

    const refreshed = await u.db("o_storyboard").where({ scriptId, projectId }).whereIn("id", storyIds);
    res.status(200).send(
      success(
        refreshed.map((item) => ({
          id: item.id,
          prompt: item.prompt,
          associateAssetsIds: typeof item.id === "number" ? referenceMap.get(item.id) || [] : [],
          src: null,
          state: item.state,
          videoDesc: item.videoDesc,
          shouldGenerateImage: item.shouldGenerateImage,
        })),
      ),
    );
  },
);
