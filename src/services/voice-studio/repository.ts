import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";
import { parseDialogue, serializeSubtitles, UtteranceKind } from "@/services/voice-studio/dialogue";

const sql = db as any;

export interface VoiceCastInput {
  id?: string;
  projectId: number;
  roleAssetId?: number | null;
  name: string;
  provider: string;
  model: string;
  voice: string;
  speechRate?: number;
  pitchRate?: number;
  volume?: number;
  emotion?: string | null;
  isDefault?: boolean;
  previewAssetId?: number | null;
}

function mapVoiceCast(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    roleAssetId: row.role_asset_id ?? null,
    name: row.name,
    provider: row.provider,
    model: row.model,
    voice: row.voice,
    speechRate: row.speech_rate,
    pitchRate: row.pitch_rate,
    volume: row.volume,
    emotion: row.emotion ?? null,
    isDefault: row.is_default === 1,
    previewAssetId: row.preview_asset_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUtterance(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id ?? null,
    storyboardId: row.storyboard_id ?? null,
    ordinal: row.ordinal,
    kind: row.kind as UtteranceKind,
    roleAssetId: row.role_asset_id ?? null,
    speaker: row.speaker,
    text: row.text,
    voiceCastId: row.voice_cast_id ?? null,
    audioPath: row.audio_path ?? null,
    cacheKey: row.cache_key ?? null,
    durationMs: row.duration_ms ?? null,
    status: row.status,
    errorMessage: row.error_message ?? null,
    locked: row.locked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCue(row: any) {
  let style = null;
  try {
    style = row.style ? JSON.parse(row.style) : null;
  } catch {
    style = null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    utteranceId: row.utterance_id,
    ordinal: row.ordinal,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    style,
    locked: row.locked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export class VoiceStudioRepository {
  async listVoiceCasts(projectId: number) {
    const rows = await sql("voice_cast").where("project_id", projectId).orderBy("is_default", "desc").orderBy("name", "asc");
    return rows.map(mapVoiceCast);
  }

  async upsertVoiceCast(input: VoiceCastInput) {
    const now = Date.now();
    const existing = input.id
      ? await sql("voice_cast").where({ id: input.id, project_id: input.projectId }).first()
      : await sql("voice_cast").where({ project_id: input.projectId, name: input.name }).first();
    const id = existing?.id ?? input.id ?? uuid();
    const row = {
      id,
      project_id: input.projectId,
      role_asset_id: input.roleAssetId ?? null,
      name: input.name.trim(),
      provider: input.provider.trim(),
      model: input.model.trim(),
      voice: input.voice.trim(),
      speech_rate: input.speechRate ?? 1,
      pitch_rate: input.pitchRate ?? 0,
      volume: input.volume ?? 1,
      emotion: input.emotion ?? null,
      is_default: input.isDefault ? 1 : 0,
      preview_asset_id: input.previewAssetId ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await sql.transaction(async (trx: any) => {
      if (input.isDefault) {
        await trx("voice_cast").where("project_id", input.projectId).whereNot("id", id).update({ is_default: 0, updated_at: now });
      }
      await trx("voice_cast").insert(row).onConflict("id").merge(row);
      await trx("utterances")
        .where("project_id", input.projectId)
        .whereNull("voice_cast_id")
        .andWhere((query: any) => {
          if (input.roleAssetId != null) query.where("role_asset_id", input.roleAssetId);
          else query.whereRaw("lower(speaker) = lower(?)", [input.name.trim()]);
        })
        .update({ voice_cast_id: id, status: "ready", updated_at: now });
    });
    return mapVoiceCast(await sql("voice_cast").where("id", id).first());
  }

  async importScript(input: { projectId: number; scriptId: number; includeStoryboardDescriptions?: boolean }) {
    const script = await sql("o_script").where({ id: input.scriptId, projectId: input.projectId }).first();
    if (!script) throw new Error("剧本不存在或不属于当前项目");
    const roleRows = await sql("o_assets")
      .leftJoin("o_scriptAssets", "o_assets.id", "o_scriptAssets.assetId")
      .where("o_scriptAssets.scriptId", input.scriptId)
      .where("o_assets.type", "role")
      .select("o_assets.id", "o_assets.name");
    const fallbackRoles = roleRows.length
      ? roleRows
      : await sql("o_assets").where({ projectId: input.projectId, type: "role" }).select("id", "name");
    const casts = await this.listVoiceCasts(input.projectId);
    const castByRole = new Map(casts.filter((item: any) => item.roleAssetId != null).map((item: any) => [item.roleAssetId, item.id]));
    const castByName = new Map(casts.map((item: any) => [normalizeName(item.name), item.id]));
    const defaultCast = casts.find((item: any) => item.isDefault)?.id ?? null;
    const sources: Array<{ content: string; storyboardId: number | null }> = [{ content: script.content ?? "", storyboardId: null }];
    if (input.includeStoryboardDescriptions) {
      const storyboards = await sql("o_storyboard")
        .where({ projectId: input.projectId, scriptId: input.scriptId })
        .whereNotNull("videoDesc")
        .orderBy("index", "asc");
      sources.push(...storyboards.map((item: any) => ({ content: item.videoDesc, storyboardId: item.id })));
    }
    const parsed = sources.flatMap((source) =>
      parseDialogue(source.content, fallbackRoles).map((item) => ({ ...item, storyboardId: source.storyboardId })),
    );
    const now = Date.now();
    const existingLocked = await sql("utterances").where({ project_id: input.projectId, script_id: input.scriptId, locked: 1 });
    const lockedSignatures = new Set(existingLocked.map((item: any) => `${item.storyboard_id ?? ""}\0${item.speaker}\0${item.text}`));
    const imported = parsed.filter((item) => !lockedSignatures.has(`${item.storyboardId ?? ""}\0${item.speaker}\0${item.text}`));
    await sql.transaction(async (trx: any) => {
      const removable = await trx("utterances")
        .where({ project_id: input.projectId, script_id: input.scriptId, locked: 0 })
        .select("id");
      if (removable.length) {
        await trx("subtitle_cues").whereIn("utterance_id", removable.map((item: any) => item.id)).where("locked", 0).delete();
        await trx("utterances").whereIn("id", removable.map((item: any) => item.id)).delete();
      }
      if (imported.length) {
        await trx("utterances").insert(
          imported.map((item, index) => {
            const voiceCastId = item.roleAssetId != null
              ? castByRole.get(item.roleAssetId) ?? castByName.get(normalizeName(item.speaker)) ?? defaultCast
              : castByName.get(normalizeName(item.speaker)) ?? defaultCast;
            return {
              id: uuid(),
              project_id: input.projectId,
              script_id: input.scriptId,
              storyboard_id: item.storyboardId,
              ordinal: index,
              kind: item.kind,
              role_asset_id: item.roleAssetId,
              speaker: item.speaker,
              text: item.text,
              voice_cast_id: voiceCastId,
              status: voiceCastId ? "ready" : "draft",
              locked: 0,
              created_at: now,
              updated_at: now,
            };
          }),
        );
      }
    });
    await this.rebuildCues({ projectId: input.projectId, scriptId: input.scriptId });
    return { imported: imported.length, preservedLocked: existingLocked.length, data: await this.listUtterances(input) };
  }

  async listUtterances(filters: { projectId: number; scriptId?: number; storyboardId?: number }) {
    const query = sql("utterances").where("project_id", filters.projectId);
    if (filters.scriptId != null) query.where("script_id", filters.scriptId);
    if (filters.storyboardId != null) query.where("storyboard_id", filters.storyboardId);
    return (await query.orderBy("ordinal", "asc").orderBy("created_at", "asc")).map(mapUtterance);
  }

  async updateUtterance(input: {
    id: string;
    projectId: number;
    speaker?: string;
    text?: string;
    kind?: UtteranceKind;
    roleAssetId?: number | null;
    voiceCastId?: string | null;
    durationMs?: number | null;
    locked?: boolean;
  }) {
    const existing = await sql("utterances").where({ id: input.id, project_id: input.projectId }).first();
    if (!existing) throw new Error("台词不存在或不属于当前项目");
    const changedContent = input.text !== undefined && input.text !== existing.text;
    const updates: any = { updated_at: Date.now() };
    if (input.speaker !== undefined) updates.speaker = input.speaker.trim();
    if (input.text !== undefined) updates.text = input.text.trim();
    if (input.kind !== undefined) updates.kind = input.kind;
    if (input.roleAssetId !== undefined) updates.role_asset_id = input.roleAssetId;
    if (input.voiceCastId !== undefined) updates.voice_cast_id = input.voiceCastId;
    if (input.durationMs !== undefined) updates.duration_ms = input.durationMs;
    if (input.locked !== undefined) updates.locked = input.locked ? 1 : 0;
    if (changedContent || input.voiceCastId !== undefined) {
      updates.audio_path = null;
      updates.cache_key = null;
      updates.error_message = null;
      updates.status = (input.voiceCastId ?? existing.voice_cast_id) ? "ready" : "draft";
    }
    await sql("utterances").where("id", input.id).update(updates);
    await sql("subtitle_cues").where({ utterance_id: input.id, locked: 0 }).update({
      text: updates.text ?? existing.text,
      updated_at: Date.now(),
    });
    return mapUtterance(await sql("utterances").where("id", input.id).first());
  }

  async rebuildCues(filters: { projectId: number; scriptId?: number }) {
    const utterances: Array<ReturnType<typeof mapUtterance>> = await this.listUtterances(filters);
    const ids = utterances.map((item: ReturnType<typeof mapUtterance>) => item.id);
    if (!ids.length) return [];
    const lockedRows = await sql("subtitle_cues").whereIn("utterance_id", ids).where("locked", 1);
    const lockedByUtterance = new Map<string, any>(lockedRows.map((row: any) => [row.utterance_id, row]));
    const now = Date.now();
    let cursor = 0;
    await sql.transaction(async (trx: any) => {
      await trx("subtitle_cues").whereIn("utterance_id", ids).where("locked", 0).delete();
      const rows: any[] = [];
      for (const utterance of utterances) {
        const locked = lockedByUtterance.get(utterance.id);
        if (locked) {
          cursor = Math.max(cursor, locked.end_ms + 120);
          continue;
        }
        const duration = utterance.durationMs ?? Math.max(1_200, Math.min(12_000, utterance.text.length * 180));
        rows.push({
          id: uuid(),
          project_id: filters.projectId,
          utterance_id: utterance.id,
          ordinal: 0,
          start_ms: cursor,
          end_ms: cursor + duration,
          text: utterance.text,
          style: null,
          locked: 0,
          created_at: now,
          updated_at: now,
        });
        cursor += duration + 120;
      }
      if (rows.length) await trx("subtitle_cues").insert(rows);
    });
    return this.listCues(filters);
  }

  async listCues(filters: { projectId: number; scriptId?: number }) {
    const query = sql("subtitle_cues")
      .leftJoin("utterances", "utterances.id", "subtitle_cues.utterance_id")
      .where("subtitle_cues.project_id", filters.projectId)
      .select("subtitle_cues.*");
    if (filters.scriptId != null) query.where("utterances.script_id", filters.scriptId);
    return (await query.orderBy("subtitle_cues.start_ms", "asc").orderBy("subtitle_cues.ordinal", "asc")).map(mapCue);
  }

  async updateCue(input: {
    id: string;
    projectId: number;
    startMs?: number;
    endMs?: number;
    text?: string;
    style?: unknown;
    locked?: boolean;
  }) {
    const existing = await sql("subtitle_cues").where({ id: input.id, project_id: input.projectId }).first();
    if (!existing) throw new Error("字幕 cue 不存在或不属于当前项目");
    const startMs = input.startMs ?? existing.start_ms;
    const endMs = input.endMs ?? existing.end_ms;
    if (endMs <= startMs) throw new Error("字幕结束时间必须晚于开始时间");
    const updates: any = { start_ms: startMs, end_ms: endMs, updated_at: Date.now() };
    if (input.text !== undefined) updates.text = input.text.trim();
    if (input.style !== undefined) updates.style = input.style == null ? null : JSON.stringify(input.style);
    if (input.locked !== undefined) updates.locked = input.locked ? 1 : 0;
    await sql("subtitle_cues").where("id", input.id).update(updates);
    return mapCue(await sql("subtitle_cues").where("id", input.id).first());
  }

  async exportSubtitles(filters: { projectId: number; scriptId?: number; format: "srt" | "vtt" }) {
    const cues = await this.listCues(filters);
    return serializeSubtitles(cues, filters.format);
  }
}

export const voiceStudioRepository = new VoiceStudioRepository();
