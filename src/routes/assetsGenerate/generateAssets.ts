import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { enqueueSingleAssetImage } from "@/services/task-engine/enqueueSingleAssetImage";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图",
    promptEnd: "人物角色四视图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

// ─── 构建生成提示词 ──────────────────────────────────────────

function buildPrompt(cfg: AssetTypeConfig, artStyle: string, name: string, prompt: string): string {
  return `
    请根据以下参数生成${cfg.promptTitle}：

    **基础参数：**
    - 画风风格: ${artStyle || "未指定"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成${cfg.promptEnd}。
  `;
}

// ─── 生成资产图片 ────────────────────────────────────────────

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.enum(["1K", "2K", "4K"]),
  id: z.number(),
  type: z.enum(["role", "scene", "tool"]),
  name: z.string(),
  prompt: z.string(),
  base64: z.string().optional().nullable(),
  requestId: z.string().trim().min(1).optional(),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, id, type, name, prompt, base64 } = req.body;

  // 1. 查询项目 & 获取类型配置
  const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  if (!project) return res.status(500).send(success({ message: "项目为空" }));

  const cfg = assetTypeConfig[type as AssetType];
  if (!cfg) return res.status(400).send(error("不支持的类型"));

  const userPrompt = buildPrompt(cfg, project.artStyle!, name, prompt);
  try {
    const result = await enqueueSingleAssetImage({
      projectId,
      assetId: id,
      assetType: type as AssetType,
      model: model as `${string}:${string}`,
      prompt: userPrompt,
      size: resolution,
      aspectRatio: "16:9",
      referenceBase64: base64 || undefined,
      requestId: req.body.requestId || `${Date.now()}-${id}`,
    });
    return res.status(200).send(success({
      queued: true,
      taskId: result.task.id,
      imageId: (result.payload as any).imageId,
      assetsId: id,
      deduped: result.deduped,
    }));
  } catch (e) {
    return res.status(400).send(error(u.error(e).message || "图片生成失败"));
  }
});
