import type { Knex } from "knex";
import { v4 as uuid } from "uuid";
import { type NovelImportPreview, sha256 } from "@/services/script-import/novelExport";

function parseReport(value: unknown): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export async function commitParsedNovelImport(database: Knex, input: { projectId: number; preview: NovelImportPreview; chapterIds: string[] }) {
  const project = await database("o_project").where("id", input.projectId).first();
  if (!project) throw new Error("项目不存在");
  const { preview } = input;
  const selectedSet = new Set(input.chapterIds);
  if (!selectedSet.size) throw new Error("请至少选择一个有正文的章节");
  const selected = preview.chapters.filter((chapter) => selectedSet.has(chapter.externalId));
  if (selected.length !== selectedSet.size) throw new Error("选择中包含导出文件不存在的章节");
  if (selected.some((chapter) => !chapter.importable)) throw new Error("不能导入没有正文的章节");
  const selectionChecksum = sha256(selected.map((chapter) => chapter.externalId).sort().join("\n"));
  const idempotencyIdentity = {
    project_id: input.projectId,
    source_type: preview.sourceType,
    external_project_id: preview.externalProjectId,
    source_checksum: preview.sourceChecksum,
    selection_checksum: selectionChecksum,
  };
  const existing = await database("script_import_batches").where(idempotencyIdentity).first();
  if (existing) return { ...parseReport(existing.report), batchId: existing.id, deduped: true };

  try {
    return await database.transaction(async (trx) => {
    const now = Date.now();
    const batchId = uuid();
    await (trx as any)("script_import_batches").insert({
      id: batchId,
      project_id: input.projectId,
      source_type: preview.sourceType,
      external_project_id: preview.externalProjectId,
      external_version: preview.externalVersion,
      source_checksum: preview.sourceChecksum,
      selection_checksum: selectionChecksum,
      importer_version: preview.importerVersion,
      status: "importing",
      report: JSON.stringify({}),
      created_at: now,
    });
    const counts = { created: 0, updated: 0, unchanged: 0 };
    const scriptIds: number[] = [];
    for (const chapter of selected) {
      const previousItem = await (trx as any)("script_import_items")
        .where({
          project_id: input.projectId,
          source_type: preview.sourceType,
          external_project_id: preview.externalProjectId,
          external_chapter_id: chapter.externalId,
        })
        .orderBy("created_at", "desc")
        .first();
      const previousScript = previousItem ? await (trx as any)("o_script").where({ id: previousItem.script_id, projectId: input.projectId }).first() : null;
      let scriptId: number;
      let action: "created" | "updated" | "unchanged";
      if (!previousScript) {
        [scriptId] = await (trx as any)("o_script").insert({ name: chapter.title, content: chapter.content, projectId: input.projectId, createTime: now });
        action = "created";
      } else {
        scriptId = previousScript.id;
        const unchanged = previousScript.name === chapter.title && previousScript.content === chapter.content;
        if (unchanged) {
          action = "unchanged";
        } else {
          await (trx as any)("o_script").where("id", scriptId).update({ name: chapter.title, content: chapter.content });
          action = "updated";
        }
      }
      counts[action]++;
      scriptIds.push(scriptId);
      await (trx as any)("script_import_items").insert({
        id: uuid(), batch_id: batchId, project_id: input.projectId, source_type: preview.sourceType,
        external_project_id: preview.externalProjectId, external_chapter_id: chapter.externalId, external_order: chapter.order,
        script_name: chapter.title, script_content: chapter.content, content_checksum: chapter.contentChecksum,
        script_id: scriptId, action, created_at: now,
      });
      await (trx as any)("project_events").insert({
        id: uuid(), project_id: input.projectId, entity_type: "script", entity_id: String(scriptId), action: `novel_import_${action}`,
        before_data: previousScript ? JSON.stringify({ name: previousScript.name, contentChecksum: previousItem?.content_checksum ?? null }) : null,
        after_data: JSON.stringify({ name: chapter.title, contentChecksum: chapter.contentChecksum, externalChapterId: chapter.externalId, batchId }),
        actor: "user", created_at: now,
      });
    }
    const report = {
      batchId, deduped: false, importerVersion: preview.importerVersion, sourceType: preview.sourceType, externalProjectId: preview.externalProjectId,
      externalVersion: preview.externalVersion, sourceChecksum: preview.sourceChecksum, selectedChapters: selected.length,
      counts, scriptIds, warnings: preview.warnings,
    };
    await (trx as any)("script_import_batches").where("id", batchId).update({ status: "succeeded", report: JSON.stringify(report) });
    return report;
    });
  } catch (error) {
    const collided = await database("script_import_batches").where(idempotencyIdentity).first();
    if (collided) return { ...parseReport(collided.report), batchId: collided.id, deduped: true };
    throw error;
  }
}
