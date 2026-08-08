import express from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueAssetImageGeneration } from "@/services/task-engine/enqueueImage";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    assetIds: z.array(z.number()),
    projectId: z.number(),
    scriptId: z.number(),
    concurrentCount: z.number().min(1).optional(),
    requestId: z.string().optional(),
  }),
  async (req, res) => {
    const { assetIds, projectId, scriptId, requestId = uuid() } = req.body;
    const project = await u.db("o_project").where("id", projectId).select("imageModel", "imageQuality").first();
    if (!project?.imageModel) return res.status(400).send(error("项目未配置图片模型"));

    const assets = await u.db("o_assets").whereIn("id", assetIds).select("id", "describe", "type", "assetsId");
    const parentIds = assets.map((item) => item.assetsId).filter((id): id is number => typeof id === "number");
    const parents = parentIds.length
      ? await u
          .db("o_assets")
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .whereIn("o_assets.id", parentIds)
          .select("o_assets.id", "o_assets.describe", "o_image.filePath")
      : [];
    const parentById = new Map<number, { describe?: string | null; filePath?: string | null }>();
    parents.forEach((item) => {
      if (typeof item.id === "number") parentById.set(item.id, item);
    });

    await Promise.all(
      assets.filter((item) => typeof item.id === "number").map((item) => {
        const parent = typeof item.assetsId === "number" ? parentById.get(item.assetsId) : undefined;
        return enqueueAssetImageGeneration({
          projectId,
          scriptId,
          assetId: item.id!,
          assetType: (["role", "tool", "scene"].includes(item.type || "") ? item.type : "role") as "role" | "tool" | "scene",
          describe: item.describe || "",
          parentDescribe: parent?.describe || undefined,
          parentImagePath: parent?.filePath || undefined,
          model: project.imageModel as `${string}:${string}`,
          size: (project.imageQuality || "1K") as "1K" | "2K" | "4K",
          requestId: `${requestId}:${item.id!}`,
        });
      }),
    );

    res.status(200).send(success("资产图片已进入持久队列"));
  },
);
