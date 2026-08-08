import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { db } from "@/utils/db";

const sql = db as any;

export type AudioTrackKind = "native" | "dialogue" | "narration" | "sfx" | "ambience" | "bgm";

export interface NormalizedTimeline {
  schemaVersion: 1;
  projectId: number;
  scriptId: number;
  settings: {
    width: number;
    height: number;
    fps: number;
    colorSpace: "bt709";
    audioSampleRate: 48_000;
    loudnessTargetLufs: -16;
    truePeakDb: -1.5;
  };
  durationMs: number;
  videoTracks: Array<{
    id: string;
    clips: Array<{
      id: string;
      sourceType: "selected_video";
      sourceId: number;
      storyboardTrackId: number;
      path: string;
      startMs: number;
      inMs: number;
      outMs: number;
      durationMs: number;
      transitionOut: { type: "cut"; durationMs: 0 };
    }>;
  }>;
  audioTracks: Array<{
    id: string;
    kind: AudioTrackKind;
    clips: Array<{
      id: string;
      sourceType: "embedded_video_audio" | "utterance_audio";
      sourceId: number | string;
      path: string;
      startMs: number;
      inMs: number;
      durationMs: number;
      gainDb: number;
      fadeInMs: number;
      fadeOutMs: number;
    }>;
  }>;
  subtitleTracks: Array<{
    id: string;
    cues: Array<{ id: string; utteranceId: string; startMs: number; endMs: number; text: string; style: unknown; locked: boolean }>;
  }>;
  warnings: string[];
}

function mapTimelineRow(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    scriptId: row.script_id,
    version: row.version,
    status: row.status,
    payload: JSON.parse(row.payload) as NormalizedTimeline,
    checksum: row.checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeStyle(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function buildNormalizedTimeline(input: { projectId: number; scriptId: number }) {
  const [project, script] = await Promise.all([
    sql("o_project").where("id", input.projectId).first(),
    sql("o_script").where({ id: input.scriptId, projectId: input.projectId }).first(),
  ]);
  if (!project || !script) throw new Error("项目或剧本不存在");

  const [tracks, storyboards, utterances, cueRows] = await Promise.all([
    sql("o_videoTrack").where({ projectId: input.projectId, scriptId: input.scriptId }),
    sql("o_storyboard").where({ projectId: input.projectId, scriptId: input.scriptId }).orderBy("index", "asc"),
    sql("utterances").where({ project_id: input.projectId, script_id: input.scriptId }).orderBy("ordinal", "asc"),
    sql("subtitle_cues")
      .leftJoin("utterances", "utterances.id", "subtitle_cues.utterance_id")
      .where("subtitle_cues.project_id", input.projectId)
      .where("utterances.script_id", input.scriptId)
      .select("subtitle_cues.*")
      .orderBy("subtitle_cues.start_ms", "asc"),
  ]);
  const firstStoryboardIndex = new Map<number, number>();
  for (const storyboard of storyboards) {
    if (storyboard.trackId != null && !firstStoryboardIndex.has(storyboard.trackId)) {
      firstStoryboardIndex.set(storyboard.trackId, Number(storyboard.index ?? Number.MAX_SAFE_INTEGER));
    }
  }
  tracks.sort((a: any, b: any) =>
    (firstStoryboardIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (firstStoryboardIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const selectedIds = tracks.map((track: any) => track.videoId).filter((id: unknown): id is number => typeof id === "number");
  const videos = selectedIds.length ? await sql("o_video").whereIn("id", selectedIds) : [];
  const videoById = new Map<number, any>(videos.map((video: any) => [video.id, video]));
  const warnings: string[] = [];
  const videoClips: NormalizedTimeline["videoTracks"][number]["clips"] = [];
  let cursor = 0;
  for (const track of tracks) {
    const selected = videoById.get(track.videoId);
    const durationMs = Math.max(1_000, Math.round((Number(track.duration) || 5) * 1000));
    if (!selected?.filePath || !["生成成功", "已完成"].includes(selected.state)) {
      warnings.push(`视频轨道 ${track.id} 尚未选择已成功的视频，未加入时间线`);
      continue;
    }
    videoClips.push({
      id: `video-${selected.id}`,
      sourceType: "selected_video",
      sourceId: selected.id,
      storyboardTrackId: track.id,
      path: selected.filePath,
      startMs: cursor,
      inMs: 0,
      outMs: durationMs,
      durationMs,
      transitionOut: { type: "cut", durationMs: 0 },
    });
    cursor += durationMs;
  }

  const nativeClips = videoClips.map((clip) => ({
    id: `native-${clip.sourceId}`,
    sourceType: "embedded_video_audio" as const,
    sourceId: clip.sourceId,
    path: clip.path,
    startMs: clip.startMs,
    inMs: clip.inMs,
    durationMs: clip.durationMs,
    gainDb: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
  }));
  const utteranceById = new Map<string, any>(utterances.map((row: any) => [row.id, row]));
  const dialogueClips: NormalizedTimeline["audioTracks"][number]["clips"] = [];
  const narrationClips: NormalizedTimeline["audioTracks"][number]["clips"] = [];
  for (const cue of cueRows) {
    const utterance = utteranceById.get(cue.utterance_id);
    if (!utterance?.audio_path || utterance.status !== "succeeded") continue;
    const target = utterance.kind === "narration" ? narrationClips : dialogueClips;
    target.push({
      id: `utterance-${utterance.id}`,
      sourceType: "utterance_audio",
      sourceId: utterance.id,
      path: utterance.audio_path,
      startMs: cue.start_ms,
      inMs: 0,
      durationMs: utterance.duration_ms ?? Math.max(1, cue.end_ms - cue.start_ms),
      gainDb: 0,
      fadeInMs: 10,
      fadeOutMs: 30,
    });
  }
  if (cueRows.some((cue: any) => cue.end_ms > cursor) && cursor > 0) {
    warnings.push("部分字幕或配音超出已选视频总时长");
  }
  const ratio = project.videoRatio === "9:16" ? "9:16" : "16:9";
  const payload: NormalizedTimeline = {
    schemaVersion: 1,
    projectId: input.projectId,
    scriptId: input.scriptId,
    settings: {
      width: ratio === "9:16" ? 1080 : 1920,
      height: ratio === "9:16" ? 1920 : 1080,
      fps: 24,
      colorSpace: "bt709",
      audioSampleRate: 48_000,
      loudnessTargetLufs: -16,
      truePeakDb: -1.5,
    },
    durationMs: cursor,
    videoTracks: [{ id: "video-main", clips: videoClips }],
    audioTracks: [
      { id: "audio-native", kind: "native", clips: nativeClips },
      { id: "audio-dialogue", kind: "dialogue", clips: dialogueClips },
      { id: "audio-narration", kind: "narration", clips: narrationClips },
      { id: "audio-sfx", kind: "sfx", clips: [] },
      { id: "audio-ambience", kind: "ambience", clips: [] },
      { id: "audio-bgm", kind: "bgm", clips: [] },
    ],
    subtitleTracks: [
      {
        id: "subtitles-main",
        cues: cueRows.map((cue: any) => ({
          id: cue.id,
          utteranceId: cue.utterance_id,
          startMs: cue.start_ms,
          endMs: cue.end_ms,
          text: cue.text,
          style: safeStyle(cue.style),
          locked: cue.locked === 1,
        })),
      },
    ],
    warnings,
  };
  const serialized = JSON.stringify(payload);
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex");
  const latest = await sql("project_timelines")
    .where({ project_id: input.projectId, script_id: input.scriptId })
    .orderBy("version", "desc")
    .first();
  if (latest?.checksum === checksum) return { timeline: mapTimelineRow(latest), deduped: true };
  const now = Date.now();
  const id = uuid();
  await sql("project_timelines").insert({
    id,
    project_id: input.projectId,
    script_id: input.scriptId,
    version: Number(latest?.version ?? 0) + 1,
    status: "draft",
    payload: serialized,
    checksum,
    created_at: now,
    updated_at: now,
  });
  return { timeline: mapTimelineRow(await sql("project_timelines").where("id", id).first()), deduped: false };
}

export async function getLatestTimeline(input: { projectId: number; scriptId: number }) {
  const row = await sql("project_timelines")
    .where({ project_id: input.projectId, script_id: input.scriptId })
    .orderBy("version", "desc")
    .first();
  return row ? mapTimelineRow(row) : null;
}

export async function listTimelines(input: { projectId: number; scriptId: number }) {
  const rows = await sql("project_timelines")
    .where({ project_id: input.projectId, script_id: input.scriptId })
    .orderBy("version", "desc");
  return rows.map(mapTimelineRow);
}
