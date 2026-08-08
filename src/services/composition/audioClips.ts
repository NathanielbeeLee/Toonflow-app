import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import { probeMedia } from "@/services/media/probe";

const sql = db as any;
export const projectAudioKinds = ["sfx", "ambience", "bgm"] as const;
export type ProjectAudioKind = (typeof projectAudioKinds)[number];

function mapRow(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    kind: row.kind,
    assetId: row.asset_id,
    name: row.name,
    path: row.path,
    startMs: row.start_ms,
    inMs: row.in_ms,
    durationMs: row.duration_ms,
    gainDb: row.gain_db,
    fadeInMs: row.fade_in_ms,
    fadeOutMs: row.fade_out_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjectAudioClips(input: { projectId: number; scriptId: number }) {
  const rows = await sql("project_audio_clips")
    .where({ project_id: input.projectId, script_id: input.scriptId })
    .orderBy("start_ms", "asc");
  return rows.map(mapRow);
}

export async function upsertProjectAudioClip(input: {
  id?: string;
  projectId: number;
  scriptId: number;
  kind: ProjectAudioKind;
  assetId: number;
  startMs: number;
  inMs: number;
  durationMs?: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}) {
  const [script, asset] = await Promise.all([
    sql("o_script").where({ id: input.scriptId, projectId: input.projectId }).first(),
    sql("o_assets")
      .leftJoin("o_image", "o_image.id", "o_assets.imageId")
      .where({ "o_assets.id": input.assetId, "o_assets.projectId": input.projectId, "o_assets.type": "audio" })
      .select("o_assets.id", "o_assets.name", "o_image.filePath")
      .first(),
  ]);
  if (!script) throw new Error("剧本不存在或不属于当前项目");
  if (!asset?.filePath) throw new Error("声音素材不存在、未完成或没有本地文件");
  const media = await probeMedia(asset.filePath);
  if (!media?.hasAudio) throw new Error("声音素材无法读取有效音轨");
  if (input.inMs >= media.durationMs) throw new Error("声音素材入点不能超过文件时长");
  const availableMs = media.durationMs - input.inMs;
  const durationMs = Math.min(input.durationMs ?? availableMs, availableMs);
  if (durationMs <= 0) throw new Error("声音素材片段时长必须大于 0");
  const now = Date.now();
  const id = input.id ?? uuid();
  const values = {
    project_id: input.projectId,
    script_id: input.scriptId,
    kind: input.kind,
    asset_id: input.assetId,
    name: asset.name || `${input.kind}-${input.assetId}`,
    path: asset.filePath,
    start_ms: input.startMs,
    in_ms: input.inMs,
    duration_ms: durationMs,
    gain_db: input.gainDb,
    fade_in_ms: Math.min(input.fadeInMs, durationMs),
    fade_out_ms: Math.min(input.fadeOutMs, durationMs),
    updated_at: now,
  };
  if (input.id) {
    const updated = await sql("project_audio_clips")
      .where({ id: input.id, project_id: input.projectId, script_id: input.scriptId })
      .update(values);
    if (updated !== 1) throw new Error("声音片段不存在");
  } else {
    await sql("project_audio_clips").insert({ id, ...values, created_at: now });
  }
  return mapRow(await sql("project_audio_clips").where("id", id).first());
}

export async function deleteProjectAudioClip(input: { id: string; projectId: number; scriptId: number }) {
  const deleted = await sql("project_audio_clips")
    .where({ id: input.id, project_id: input.projectId, script_id: input.scriptId })
    .delete();
  if (deleted !== 1) throw new Error("声音片段不存在");
  return { id: input.id };
}
