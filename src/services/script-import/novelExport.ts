import crypto from "node:crypto";
import { z } from "zod";

export const NOVEL_IMPORTER_VERSION = "ai-novel-json-v1";
export const NOVEL_IMPORT_SOURCE_TYPE = "ai-novel-writing-assistant";
export const DRAMA_IMPORTER_VERSION = "ai-novel-drama-json-v1";
export const DRAMA_IMPORT_SOURCE_TYPE = "ai-novel-writing-assistant-drama";

const chapterSchema = z.object({
  id: z.string().trim().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().trim(),
  content: z.string().nullable().optional(),
}).passthrough();

const characterSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().optional().nullable(),
}).passthrough();

const exportSchema = z.object({
  metadata: z.object({
    exportedAt: z.string().trim().min(1),
    novelId: z.string().trim().min(1),
    novelTitle: z.string().trim().min(1),
    scope: z.string().optional(),
  }).passthrough(),
  data: z.record(z.string(), z.unknown()),
}).passthrough();

const dramaExportSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  updatedAt: z.string().optional().nullable(),
  episodes: z.array(z.object({
    id: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    title: z.string().trim(),
    content: z.string().nullable().optional(),
    updatedAt: z.string().optional().nullable(),
  }).passthrough()),
  characters: z.array(characterSchema).default([]),
}).passthrough();

export interface NovelImportChapterPreview {
  externalId: string;
  order: number;
  title: string;
  content: string;
  contentLength: number;
  contentChecksum: string;
  importable: boolean;
  preview: string;
}

export interface NovelImportPreview {
  importerVersion: string;
  sourceType: string;
  sourceChecksum: string;
  externalProjectId: string;
  externalVersion: string;
  title: string;
  scope: string;
  chapters: NovelImportChapterPreview[];
  characters: Array<{ externalId: string; name: string; role: string | null }>;
  summary: {
    totalChapters: number;
    importableChapters: number;
    emptyChapters: number;
    characters: number;
    structuredScenes: number | null;
    structuredDialogues: number | null;
    props: number | null;
  };
  ignoredSections: string[];
  warnings: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseDramaProjectExport(raw: unknown): NovelImportPreview {
  const parsed = dramaExportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`不符合 AI Novel 短剧导出契约：${issue.path.join(".")} ${issue.message}`);
  }
  const chapters = parsed.data.episodes
    .map((episode) => {
      const content = (episode.content ?? "").replace(/\r\n?/g, "\n").trim();
      const title = episode.title || `第${episode.order}集`;
      return {
        externalId: episode.id,
        order: episode.order,
        title,
        content,
        contentLength: content.length,
        contentChecksum: sha256(`${title}\n${content}`),
        importable: content.length > 0,
        preview: content.slice(0, 180),
      };
    })
    .sort((left, right) => left.order - right.order || left.externalId.localeCompare(right.externalId));
  const emptyCount = chapters.filter((chapter) => !chapter.importable).length;
  if (new Set(chapters.map((chapter) => chapter.externalId)).size !== chapters.length) throw new Error("短剧分集外部 ID 重复，无法建立稳定映射");
  const warnings = [
    "短剧项目 JSON 提供分集台本和角色，但不包含单集 timeline 的结构化镜头；本次保留分集原文，不猜测镜头字段",
    "角色只用于导入前核对，不会自动创建或合并 Toonflow 资产；导入后可使用现有“提取资产”流程",
  ];
  const dramaOrderCounts = new Map<number, number>();
  for (const chapter of chapters) dramaOrderCounts.set(chapter.order, (dramaOrderCounts.get(chapter.order) ?? 0) + 1);
  const duplicateDramaOrders = [...dramaOrderCounts].filter(([, count]) => count > 1).map(([order]) => order);
  if (duplicateDramaOrders.length) warnings.push(`分集序号重复：${duplicateDramaOrders.join("、")}；导入仍按序号和外部 ID 稳定排序`);
  if (emptyCount) warnings.push(`${emptyCount} 个分集没有台本正文，默认不导入`);
  return {
    importerVersion: DRAMA_IMPORTER_VERSION,
    sourceType: DRAMA_IMPORT_SOURCE_TYPE,
    sourceChecksum: sha256(JSON.stringify(stableValue(raw))),
    externalProjectId: parsed.data.id,
    externalVersion: parsed.data.updatedAt ?? parsed.data.episodes.map((episode) => episode.updatedAt).filter(Boolean).sort().at(-1) ?? "unknown",
    title: parsed.data.title,
    scope: "drama-project",
    chapters,
    characters: parsed.data.characters.map((character) => ({ externalId: character.id, name: character.name, role: character.role ?? null })),
    summary: {
      totalChapters: chapters.length,
      importableChapters: chapters.filter((chapter) => chapter.importable).length,
      emptyChapters: emptyCount,
      characters: parsed.data.characters.length,
      structuredScenes: null,
      structuredDialogues: null,
      props: null,
    },
    ignoredSections: Object.keys(parsed.data).filter((key) => !["id", "title", "updatedAt", "episodes", "characters"].includes(key)),
    warnings,
  };
}

export function parseNovelExportJson(content: string): NovelImportPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("不是有效的 JSON；请从 AI Novel Writing Assistant 选择 JSON 格式导出");
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).episodes)) return parseDramaProjectExport(raw);
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`不符合 AI Novel 导出契约：${issue.path.join(".")} ${issue.message}`);
  }
  const { metadata, data } = parsed.data;
  const chapterSection = data.chapter && typeof data.chapter === "object" ? data.chapter as Record<string, unknown> : data;
  const characterSection = data.character && typeof data.character === "object" ? data.character as Record<string, unknown> : {};
  const chapterList = z.array(chapterSchema).safeParse(chapterSection.chapters);
  if (!chapterList.success) throw new Error("导出数据缺少 data.chapter.chapters；请使用 scope=full 或 scope=chapter 的 JSON 导出");
  const characterList = z.array(characterSchema).safeParse(characterSection.characters ?? []);
  if (!characterList.success) throw new Error("data.character.characters 字段格式无效");

  const chapters = chapterList.data
    .map((chapter) => {
      const normalizedContent = (chapter.content ?? "").replace(/\r\n?/g, "\n").trim();
      const normalizedTitle = chapter.title || `第${chapter.order}章`;
      return {
        externalId: chapter.id,
        order: chapter.order,
        title: normalizedTitle,
        content: normalizedContent,
        contentLength: normalizedContent.length,
        contentChecksum: sha256(`${normalizedTitle}\n${normalizedContent}`),
        importable: normalizedContent.length > 0,
        preview: normalizedContent.slice(0, 180),
      };
    })
    .sort((left, right) => left.order - right.order || left.externalId.localeCompare(right.externalId));

  const warnings: string[] = [];
  const duplicateIds = chapters.filter((chapter, index) => chapters.findIndex((item) => item.externalId === chapter.externalId) !== index);
  if (duplicateIds.length) throw new Error(`章节外部 ID 重复：${[...new Set(duplicateIds.map((item) => item.externalId))].join("、")}`);
  const orderCounts = new Map<number, number>();
  for (const chapter of chapters) orderCounts.set(chapter.order, (orderCounts.get(chapter.order) ?? 0) + 1);
  const duplicateOrders = [...orderCounts].filter(([, count]) => count > 1).map(([order]) => order);
  if (duplicateOrders.length) warnings.push(`章节序号重复：${duplicateOrders.join("、")}；导入仍按序号和外部 ID 稳定排序`);
  const emptyCount = chapters.filter((chapter) => !chapter.importable).length;
  if (emptyCount) warnings.push(`${emptyCount} 个章节没有正文，默认不导入`);
  warnings.push("来源契约没有结构化场次、对白和道具字段；本次只按章节原文导入，不会猜测或改写内容");
  warnings.push("角色只用于导入前核对，不会自动创建或合并 Toonflow 资产；导入后可使用现有“提取资产”流程");
  if (metadata.scope && !["full", "chapter"].includes(metadata.scope)) warnings.push(`当前导出范围为 ${metadata.scope}，可能缺少章节或角色数据`);

  const knownSections = new Set(["basic", "story_macro", "character", "outline", "structured", "chapter", "pipeline", "chapters"]);
  const ignoredSections = Object.keys(data).filter((key) => !knownSections.has(key));
  return {
    importerVersion: NOVEL_IMPORTER_VERSION,
    sourceType: NOVEL_IMPORT_SOURCE_TYPE,
    sourceChecksum: sha256(JSON.stringify(stableValue(raw))),
    externalProjectId: metadata.novelId,
    externalVersion: metadata.exportedAt,
    title: metadata.novelTitle,
    scope: metadata.scope ?? "full",
    chapters,
    characters: characterList.data.map((character) => ({ externalId: character.id, name: character.name, role: character.role ?? null })),
    summary: {
      totalChapters: chapters.length,
      importableChapters: chapters.filter((chapter) => chapter.importable).length,
      emptyChapters: emptyCount,
      characters: characterList.data.length,
      structuredScenes: null,
      structuredDialogues: null,
      props: null,
    },
    ignoredSections,
    warnings,
  };
}

function allowedImportHost(url: URL): boolean {
  const defaults = new Set(["localhost", "127.0.0.1", "::1"]);
  const configured = (process.env.TOONFLOW_NOVEL_IMPORT_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return defaults.has(url.hostname.toLowerCase()) || configured.includes(url.hostname.toLowerCase()) || configured.includes(url.host.toLowerCase());
}

export async function fetchNovelExportJson(input: { baseUrl: string; novelId: string; projectKind?: "novel" | "drama"; apiToken?: string }): Promise<string> {
  const base = new URL(input.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error("API 地址必须是无内嵌凭据的 HTTP(S) 地址");
  if (!allowedImportHost(base)) throw new Error("为防止服务端请求伪造，默认只允许本机 novel API；远端主机需加入 TOONFLOW_NOVEL_IMPORT_HOSTS");
  const endpoint = new URL(input.projectKind === "drama"
    ? `/api/drama/projects/${encodeURIComponent(input.novelId)}/export`
    : `/api/novels/${encodeURIComponent(input.novelId)}/export`, base);
  endpoint.searchParams.set("format", "json");
  if (input.projectKind !== "drama") endpoint.searchParams.set("scope", "full");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      headers: input.apiToken ? { Authorization: `Bearer ${input.apiToken}` } : undefined,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`novel API 返回 HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > 25 * 1024 * 1024) throw new Error("novel JSON 超过 25MB 导入上限");
    const content = await response.text();
    if (Buffer.byteLength(content, "utf8") > 25 * 1024 * 1024) throw new Error("novel JSON 超过 25MB 导入上限");
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("novel API 连接超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
