import { db } from "@/utils/db";
import { fetchNovelExportJson, parseNovelExportJson } from "@/services/script-import/novelExport";
import { commitParsedNovelImport } from "@/services/script-import/persistence";

const sql = db as any;

export type NovelImportSource =
  | { mode: "json"; content: string }
  | { mode: "api"; baseUrl: string; novelId: string; projectKind?: "novel" | "drama"; apiToken?: string };

async function resolveContent(source: NovelImportSource): Promise<string> {
  return source.mode === "json" ? source.content : fetchNovelExportJson(source);
}

export async function previewNovelImport(input: { projectId: number; source: NovelImportSource }) {
  const project = await sql("o_project").where("id", input.projectId).first();
  if (!project) throw new Error("项目不存在");
  const preview = parseNovelExportJson(await resolveContent(input.source));
  const history = await sql("script_import_items")
    .where({ project_id: input.projectId, source_type: preview.sourceType, external_project_id: preview.externalProjectId })
    .orderBy("created_at", "desc");
  const latestByExternalId = new Map<string, any>();
  for (const item of history) if (!latestByExternalId.has(item.external_chapter_id)) latestByExternalId.set(item.external_chapter_id, item);
  const scriptIds = [...new Set([...latestByExternalId.values()].map((item) => item.script_id))];
  const scripts = scriptIds.length ? await sql("o_script").where("projectId", input.projectId).whereIn("id", scriptIds) : [];
  const scriptsById = new Map<number, any>(scripts.map((script: any) => [script.id, script]));
  return {
    ...preview,
    chapters: preview.chapters.map((chapter) => {
      const previous = latestByExternalId.get(chapter.externalId);
      const script = previous ? scriptsById.get(previous.script_id) : null;
      const plannedAction = !script ? "create" : script.name === chapter.title && script.content === chapter.content ? "unchanged" : "update";
      return { ...chapter, plannedAction, currentScriptId: script?.id ?? null };
    }),
  };
}

export async function commitNovelImport(input: { projectId: number; source: NovelImportSource; chapterIds: string[] }) {
  const preview = await previewNovelImport({ projectId: input.projectId, source: input.source });
  return commitParsedNovelImport(db, { projectId: input.projectId, preview, chapterIds: input.chapterIds });
}
