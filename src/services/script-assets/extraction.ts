import { tool, jsonSchema } from "ai";
import { z } from "zod";
import u from "@/utils";
import { db } from "@/utils/db";
import { TaskExecutionError } from "@/domain/generationTask";
import type { TaskHandlerContext } from "@/services/task-engine/worker";
import { generationTaskRepository, stableIdempotencyKey } from "@/services/task-engine/repository";

const sql = db as any;

const NewAssetSchema = z.object({
  name: z.string().trim().min(1).describe("资产名称，仅为名称"),
  desc: z.string().trim().min(1).describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
  scriptIds: z.array(z.number().int().positive()).describe("使用该资产的本批剧本 ID"),
});

const ExistingAssetRefSchema = z.object({
  name: z.string().trim().min(1).describe("已有资产名称"),
  type: z.enum(["role", "tool", "scene"]).describe("已有资产类型"),
  scriptIds: z.array(z.number().int().positive()).describe("使用该资产的本批剧本 ID"),
});

type NewAsset = z.infer<typeof NewAssetSchema>;
type ExistingAssetRef = z.infer<typeof ExistingAssetRefSchema>;
type AssetIdentity = { id?: number; name?: string | null; type?: string | null };

export interface ScriptAssetExtractionTaskPayload {
  projectId: number;
  scriptIds: number[];
  groupSize: number;
  model: "configured:universalAi";
}

function normalizedAssetName(name: string, type?: string | null): string {
  const compact = name.normalize("NFKC").replace(/[\s\u3000]+/g, "").toLowerCase();
  if (type === "scene") return compact;
  const withoutQualifier = compact.replace(/[（(][^（）()]*[）)]/g, "").replace(/[（(].*$/, "");
  return withoutQualifier || compact;
}

function findExistingAsset(assets: AssetIdentity[], name: string, type: string): AssetIdentity | undefined {
  const candidates = assets.filter((asset) => asset.type === type);
  const exact = candidates.filter((asset) => asset.name === name);
  if (exact.length === 1) return exact[0];
  const normalized = normalizedAssetName(name, type);
  const matches = candidates.filter((asset) => asset.name && normalizedAssetName(asset.name, asset.type) === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function persistBatch(input: {
  projectId: number;
  batchScriptIds: number[];
  newAssets: NewAsset[];
  existingRefs: ExistingAssetRef[];
}) {
  const allowedScriptIds = new Set(input.batchScriptIds);
  return db.transaction(async (trx) => {
    const table = trx as any;
    const existingAssets = await table("o_assets").where("projectId", input.projectId).select("id", "name", "type");
    const identities: AssetIdentity[] = [...existingAssets];
    const toInsert = input.newAssets.filter((asset) => {
      if (findExistingAsset(identities, asset.name, asset.type)) return false;
      identities.push({ name: asset.name, type: asset.type });
      return true;
    });
    if (toInsert.length) {
      await table("o_assets").insert(toInsert.map((asset) => ({
        name: asset.name,
        type: asset.type,
        describe: asset.desc,
        projectId: input.projectId,
        startTime: Date.now(),
      })));
    }

    const allAssets = await table("o_assets").where("projectId", input.projectId).select("id", "name", "type");
    const rows: Array<{ scriptId: number; assetId: number }> = [];
    for (const asset of input.newAssets) {
      const assetId = findExistingAsset(allAssets, asset.name, asset.type)?.id;
      if (!assetId) continue;
      for (const scriptId of asset.scriptIds) {
        if (allowedScriptIds.has(scriptId)) rows.push({ scriptId, assetId });
      }
    }
    for (const ref of input.existingRefs) {
      const assetId = findExistingAsset(allAssets, ref.name, ref.type)?.id;
      if (!assetId) continue;
      for (const scriptId of ref.scriptIds) {
        if (allowedScriptIds.has(scriptId)) rows.push({ scriptId, assetId });
      }
    }
    const uniqueRows = [...new Map(rows.map((row) => [`${row.scriptId}_${row.assetId}`, row])).values()];
    if (!uniqueRows.length) throw new TaskExecutionError("AI 返回的资产关联不属于本批剧本", "ASSET_EXTRACTION_INVALID_SCRIPT_IDS", false, true);

    await table("o_scriptAssets").whereIn("scriptId", input.batchScriptIds).delete();
    await table("o_scriptAssets").insert(uniqueRows);
    await table("o_script").where("projectId", input.projectId).whereIn("id", input.batchScriptIds).update({
      extractState: 1,
      errorReason: null,
    });
    return { assetsCreated: toInsert.length, linksWritten: uniqueRows.length };
  });
}

async function extractBatch(projectId: number, scripts: any[]) {
  const existingAssets = await sql("o_assets").where("projectId", projectId).select("name", "type");
  const existingAssetsList = existingAssets.map((asset: any) => `${asset.name}(${asset.type})`).join("、");
  const scriptsContent = scripts
    .map((script: any) => `===== 【剧本ID: ${script.id}】${script.name || ""} =====\n${script.content}`)
    .join("\n\n");
  let collectedNew: NewAsset[] = [];
  let collectedExisting: ExistingAssetRef[] = [];
  const resultTool = tool({
    description: "返回完整资产提取结果",
    inputSchema: jsonSchema<{ newAssets: NewAsset[]; existingAssetRefs: ExistingAssetRef[] }>(z.object({
      newAssets: z.array(NewAssetSchema).describe("不在已有列表中的新资产"),
      existingAssetRefs: z.array(ExistingAssetRefSchema).describe("本批剧本引用的已有资产"),
    }).toJSONSchema()),
    execute: async ({ newAssets, existingAssetRefs }) => {
      collectedNew = newAssets || [];
      collectedExisting = existingAssetRefs || [];
      return "资产结果已接收";
    },
  });
  const promptData = await sql("o_prompt").where("type", "scriptAssetExtraction").first();
  const extractionPrompt = promptData?.useData || promptData?.data || "";
  const existingHint = existingAssetsList
    ? `\n\n【已有资产列表】：${existingAssetsList}\n已有资产必须在 existingAssetRefs 中给出完全一致的名称、type 和本批 scriptIds。角色或道具名称仅多出括号定位词时复用已有资产；场景括号通常表示不同子地点，不要合并。`
    : "";
  await u.Ai.Text("universalAi").invoke({
    messages: [
      {
        role: "system",
        content: `${extractionPrompt}\n\n提取剧本中的角色、场景和关键道具，结果必须一次性通过 resultTool 返回。scriptIds 只能使用本次输入标题中明确给出的剧本 ID。`,
      },
      {
        role: "user",
        content: `当前已有资产列表：${existingHint}\n\n请分析以下${scripts.length}集剧本：\n\n${scriptsContent}`,
      },
    ],
    tools: { resultTool },
  });
  if (!collectedNew.length && !collectedExisting.length) {
    throw new TaskExecutionError("AI 未返回任何资产", "ASSET_EXTRACTION_EMPTY", false, true);
  }
  return { newAssets: collectedNew, existingRefs: collectedExisting };
}

export async function executeScriptAssetExtraction(payload: ScriptAssetExtractionTaskPayload, context: TaskHandlerContext) {
  const scripts = await sql("o_script")
    .where("projectId", payload.projectId)
    .whereIn("id", payload.scriptIds)
    .orderBy("id", "asc");
  if (scripts.length !== payload.scriptIds.length) {
    throw new TaskExecutionError("部分剧本不存在或不属于当前项目", "ASSET_EXTRACTION_SCOPE_CHANGED", false, true);
  }
  await sql("o_script").where("projectId", payload.projectId).whereIn("id", payload.scriptIds).update({ extractState: 0, errorReason: null });
  await context.throwIfCancelled();
  await context.transitionToSubmitting();

  const batchSize = Math.max(1, Math.min(100, payload.groupSize * 5));
  const totals = { batches: 0, assetsCreated: 0, linksWritten: 0 };
  for (const batch of chunk(scripts, batchSize)) {
    await context.throwIfCancelled();
    const extracted = await extractBatch(payload.projectId, batch);
    await context.throwIfCancelled();
    const saved = await persistBatch({
      projectId: payload.projectId,
      batchScriptIds: batch.map((script: any) => script.id),
      ...extracted,
    });
    totals.batches++;
    totals.assetsCreated += saved.assetsCreated;
    totals.linksWritten += saved.linksWritten;
  }
  await context.transitionToFinalizing();
  return totals;
}

export async function enqueueScriptAssetExtraction(input: {
  projectId: number;
  scriptIds: number[];
  groupSize: number;
  requestId: string;
}) {
  const scriptIds = [...new Set(input.scriptIds)].sort((a, b) => a - b);
  if (!scriptIds.length) throw new Error("请先选择剧本");
  const [project, scripts] = await Promise.all([
    sql("o_project").where("id", input.projectId).first(),
    sql("o_script").where("projectId", input.projectId).whereIn("id", scriptIds).select("id"),
  ]);
  if (!project) throw new Error("项目不存在");
  if (scripts.length !== scriptIds.length) throw new Error("部分剧本不存在或不属于当前项目");

  const now = Date.now();
  const [legacyTaskId] = await sql("o_tasks").insert({
    projectId: input.projectId,
    taskClass: "剧本资产提取",
    relatedObjects: JSON.stringify({ scriptIds }),
    model: "universalAi",
    describe: `持久提取 ${scriptIds.length} 集剧本资产`,
    state: "排队中",
    startTime: now,
  });
  const payload: ScriptAssetExtractionTaskPayload = {
    projectId: input.projectId,
    scriptIds,
    groupSize: Math.max(1, Math.min(20, Math.round(input.groupSize || 5))),
    model: "configured:universalAi",
  };
  try {
    const queued = await generationTaskRepository.enqueue({
      projectId: input.projectId,
      legacyTaskId,
      lane: "text",
      type: "script.assets.extract",
      resourceKey: `script-assets:project:${input.projectId}`,
      payload,
      provider: "configured-text",
      idempotencyKey: stableIdempotencyKey({ type: "script.assets.extract", projectId: input.projectId, scriptIds, requestId: input.requestId }),
      maxAttempts: 1,
    });
    if (queued.deduped) {
      await sql("o_tasks").where("id", legacyTaskId).delete();
      const activePayload = queued.task.payload as ScriptAssetExtractionTaskPayload | null;
      if (!activePayload || activePayload.projectId !== input.projectId || activePayload.scriptIds.join(",") !== scriptIds.join(",")) {
        throw new Error("当前项目已有其他剧本的资产提取任务，请等待完成后再提交本批剧本");
      }
      return { task: queued.task, deduped: true };
    }
    await sql("o_script").where("projectId", input.projectId).whereIn("id", scriptIds).update({ extractState: 2, errorReason: null });
    return { task: queued.task, deduped: false };
  } catch (error) {
    await sql("o_tasks").where("id", legacyTaskId).delete();
    throw error;
  }
}
