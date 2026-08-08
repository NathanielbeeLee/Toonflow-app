import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import u from "@/utils";
import { NormalizedTimeline } from "@/services/composition/timeline";
import { probeMedia } from "@/services/media/probe";

export const compositionRenderPresets = ["preview-low", "final-high"] as const;
export type CompositionRenderPreset = (typeof compositionRenderPresets)[number];

type TimelineAudioClip = NormalizedTimeline["audioTracks"][number]["clips"][number];

interface RenderInput {
  taskId: string;
  timeline: NormalizedTimeline;
  outputPath: string;
  preset: CompositionRenderPreset;
  shouldCancel(): Promise<boolean>;
}

interface ProcessResult {
  stderrTail: string;
}

interface LoudnessStats {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

function seconds(milliseconds: number): string {
  return (Math.max(1, milliseconds) / 1000).toFixed(3);
}

function renderSettings(timeline: NormalizedTimeline, preset: CompositionRenderPreset) {
  if (preset === "final-high") {
    return { width: timeline.settings.width, height: timeline.settings.height, encoderPreset: "medium", crf: "20" };
  }
  return timeline.settings.height > timeline.settings.width
    ? { width: 480, height: 854, encoderPreset: "veryfast", crf: "30" }
    : { width: 854, height: 480, encoderPreset: "veryfast", crf: "30" };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function runFfmpeg(executable: string, args: string[], shouldCancel: () => Promise<boolean>): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], shell: false });
    let stderrTail = "";
    let cancelCheckRunning = false;
    let cancelled = false;
    const appendTail = (value: string) => {
      stderrTail = `${stderrTail}${value}`.slice(-32_000);
    };
    child.stderr.on("data", (chunk) => appendTail(String(chunk)));
    const cancelTimer = setInterval(() => {
      if (cancelCheckRunning || child.exitCode != null) return;
      cancelCheckRunning = true;
      void shouldCancel()
        .then((requested) => {
          if (!requested || child.exitCode != null) return;
          cancelled = true;
          child.kill("SIGTERM");
        })
        .finally(() => {
          cancelCheckRunning = false;
        });
    }, 1_000);
    cancelTimer.unref?.();
    child.on("error", (error) => {
      clearInterval(cancelTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearInterval(cancelTimer);
      if (cancelled) return reject(new Error("渲染已取消"));
      if (code !== 0) {
        return reject(new Error(`FFmpeg 渲染失败（exit=${code ?? "null"}, signal=${signal ?? "none"}）：${stderrTail.slice(-2_000)}`));
      }
      resolve({ stderrTail });
    });
  });
}

export async function renderTimelinePreview(input: RenderInput) {
  if (!compositionRenderPresets.includes(input.preset)) throw new Error(`不支持的渲染预设: ${input.preset}`);
  const clips = input.timeline.videoTracks.flatMap((track) => track.clips).sort((a, b) => a.startMs - b.startMs);
  if (clips.length === 0) throw new Error("时间线没有可渲染的视频片段，请先在制作工作台完成选片并重新构建时间线");

  const absoluteInputs: string[] = [];
  const videoMedia = [];
  const missingVideoInputs: string[] = [];
  for (const clip of clips) {
    const absolutePath = await u.oss.getAbsolutePath(clip.path);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      missingVideoInputs.push(`视频轨道 ${clip.storyboardTrackId}（候选视频 ${clip.sourceId}）`);
      continue;
    }
    absoluteInputs.push(absolutePath);
    videoMedia.push(await probeMedia(clip.path));
  }
  if (missingVideoInputs.length) {
    throw new Error(`以下镜头的本地视频文件已丢失：${missingVideoInputs.join("、")}。请重新生成或重新选片后再构建时间线。`);
  }

  const absoluteOutput = await u.oss.getAbsolutePath(input.outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const partialOutput = `${absoluteOutput}.partial-${input.taskId}.mkv`;
  const normalizedOutput = `${absoluteOutput}.normalized-${input.taskId}.mp4`;
  await fs.rm(partialOutput, { force: true });
  await fs.rm(normalizedOutput, { force: true });
  const settings = renderSettings(input.timeline, input.preset);
  const filterParts = clips.map((clip, index) =>
    `[${index}:v]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
      `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `fps=${input.timeline.settings.fps},setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
  );
  filterParts.push(`${clips.map((_, index) => `[v${index}]`).join("")}concat=n=${clips.length}:v=1:a=0[vbase]`);
  const subtitleCues = input.timeline.subtitleTracks
    .flatMap((track) => track.cues)
    .filter((cue) => cue.text.trim() && cue.endMs > cue.startMs && cue.startMs < input.timeline.durationMs)
    .sort((a, b) => a.startMs - b.startMs);

  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  clips.forEach((clip, index) => {
    args.push("-ss", seconds(clip.inMs), "-t", seconds(clip.durationMs), "-i", absoluteInputs[index]);
  });
  const durationMs = clips.reduce((total, clip) => total + clip.durationMs, 0);
  const audioFilters: string[] = [];
  const audioLabelsByKind = new Map<string, string[]>();
  const skippedAudio: Array<{ id: string; reason: string }> = [];
  const addAudioLabel = (kind: string, label: string) => {
    const labels = audioLabelsByKind.get(kind) || [];
    labels.push(`[${label}]`);
    audioLabelsByKind.set(kind, labels);
  };
  const nativeTrack = input.timeline.audioTracks.find((track) => track.kind === "native");
  for (const nativeClip of nativeTrack?.clips || []) {
    const videoInputIndex = clips.findIndex(
      (clip) => clip.sourceId === nativeClip.sourceId && clip.startMs === nativeClip.startMs,
    );
    if (videoInputIndex < 0 || !videoMedia[videoInputIndex]?.hasAudio) {
      skippedAudio.push({ id: nativeClip.id, reason: "源视频没有可用音轨" });
      continue;
    }
    const label = `audio-native-${videoInputIndex}`;
    audioFilters.push(buildAudioFilter(`${videoInputIndex}:a:0`, nativeClip, label));
    addAudioLabel("native", label);
  }
  const externalAudioClips = input.timeline.audioTracks
    .filter((track) => track.kind !== "native")
    .flatMap((track) => track.clips.map((clip) => ({ trackKind: track.kind, clip })));
  let nextInputIndex = clips.length;
  const trackNames: Record<string, string> = { dialogue: "对白", narration: "旁白", sfx: "音效", ambience: "环境声", bgm: "背景音乐" };
  for (const { trackKind, clip } of externalAudioClips) {
    const absolutePath = await u.oss.getAbsolutePath(clip.path);
    const stat = await fs.stat(absolutePath).catch(() => null);
    const media = stat?.isFile() ? await probeMedia(clip.path) : null;
    if (!stat?.isFile() || !media?.hasAudio) {
      skippedAudio.push({ id: clip.id, reason: `${trackNames[trackKind] || trackKind}音频缺失或不可读取` });
      continue;
    }
    const inputIndex = nextInputIndex++;
    args.push("-ss", seconds(clip.inMs), "-t", seconds(clip.durationMs), "-i", absolutePath);
    const label = `audio-${trackKind}-${inputIndex}`;
    audioFilters.push(buildAudioFilter(`${inputIndex}:a:0`, clip, label));
    addAudioLabel(trackKind, label);
  }
  const subtitleOverlayFiles: string[] = [];
  let videoLabel = "vbase";
  for (const [index, cue] of subtitleCues.entries()) {
    const overlayPath = `${absoluteOutput}.subtitle-${input.taskId}-${index}.png`;
    await renderSubtitleOverlay({
      outputPath: overlayPath,
      width: settings.width,
      height: settings.height,
      text: cue.text,
      highQuality: input.preset === "final-high",
    });
    subtitleOverlayFiles.push(overlayPath);
    const overlayInputIndex = nextInputIndex++;
    args.push("-i", overlayPath);
    const nextLabel = index === subtitleCues.length - 1 ? "vout" : `vsub${index}`;
    filterParts.push(
      `[${videoLabel}][${overlayInputIndex}:v:0]overlay=0:0:eof_action=repeat:` +
        `enable='between(t,${seconds(cue.startMs)},${seconds(Math.min(cue.endMs, input.timeline.durationMs))})'[${nextLabel}]`,
    );
    videoLabel = nextLabel;
  }
  if (subtitleCues.length === 0) filterParts.push("[vbase]null[vout]");
  const silentAudioIndex = nextInputIndex;
  const silentLabel = "audio-silent";
  audioFilters.push(
    `[${silentAudioIndex}:a:0]atrim=duration=${seconds(durationMs)},` +
      `asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=${input.timeline.settings.audioSampleRate}:channel_layouts=stereo[${silentLabel}]`,
  );
  const busLabels = new Map<string, string>();
  for (const [kind, labels] of audioLabelsByKind) {
    const busLabel = `bus-${kind}`;
    audioFilters.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[${busLabel}]`);
    busLabels.set(kind, `[${busLabel}]`);
  }
  const dialogueBus = busLabels.get("dialogue");
  const backgroundLabels = ["native", "narration", "sfx", "ambience", "bgm"]
    .map((kind) => busLabels.get(kind))
    .filter((label): label is string => Boolean(label));
  let programLabels: string[];
  if (dialogueBus && backgroundLabels.length) {
    audioFilters.push(`${backgroundLabels.join("")}amix=inputs=${backgroundLabels.length}:duration=longest:normalize=0[background]`);
    audioFilters.push(`${dialogueBus}asplit=2[dialogue-program][dialogue-sidechain]`);
    audioFilters.push(
      `[background][dialogue-sidechain]sidechaincompress=threshold=0.035:ratio=8:attack=20:release=350:makeup=1[ducked-background]`,
    );
    programLabels = ["[ducked-background]", "[dialogue-program]"];
  } else {
    programLabels = [...backgroundLabels, ...(dialogueBus ? [dialogueBus] : [])];
  }
  programLabels.unshift(`[${silentLabel}]`);
  filterParts.push(...audioFilters);
  filterParts.push(
    `${programLabels.join("")}amix=inputs=${programLabels.length}:duration=longest:normalize=0,` +
      `atrim=duration=${seconds(durationMs)},` +
      `afade=t=in:st=0:d=0.08,afade=t=out:st=${Math.max(0, durationMs / 1000 - 0.12).toFixed(3)}:d=0.12,` +
      `alimiter=limit=0.95:attack=5:release=50[aout]`,
  );
  args.push(
    "-f", "lavfi",
    "-t", seconds(durationMs),
    "-i", `anullsrc=channel_layout=stereo:sample_rate=${input.timeline.settings.audioSampleRate}`,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", settings.encoderPreset,
    "-crf", settings.crf,
    "-pix_fmt", "yuv420p",
    "-c:a", "pcm_s24le",
    "-ar", String(input.timeline.settings.audioSampleRate),
    "-shortest",
    "-f", "matroska",
    partialOutput,
  );

  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  console.info("[composition.render]", JSON.stringify({
    event: "ffmpeg_started",
    taskId: input.taskId,
    preset: input.preset,
    clipCount: clips.length,
    audioClipCount: [...audioLabelsByKind.values()].reduce((total, labels) => total + labels.length, 0),
    skippedAudioCount: skippedAudio.length,
    durationMs,
    subtitleCueCount: subtitleCues.length,
    width: settings.width,
    height: settings.height,
  }));
  try {
    const processResult = await runFfmpeg(executable, args, input.shouldCancel);
    const measuredLoudness = await analyzeLoudness(
      executable,
      partialOutput,
      input.timeline.settings.loudnessTargetLufs,
      input.timeline.settings.truePeakDb,
      input.shouldCancel,
    );
    const loudnessFilter = measuredLoudness
      ? buildSecondPassLoudnessFilter(measuredLoudness, input.timeline.settings.loudnessTargetLufs, input.timeline.settings.truePeakDb)
      : "anull";
    const normalizationResult = await runFfmpeg(
      executable,
      [
        "-hide_banner", "-nostdin", "-y", "-i", partialOutput,
        "-map", "0:v:0", "-map", "0:a:0",
        "-c:v", "copy",
        "-af", loudnessFilter,
        "-c:a", "aac", "-b:a", input.preset === "final-high" ? "192k" : "128k",
        "-ar", String(input.timeline.settings.audioSampleRate),
        "-movflags", "+faststart",
        normalizedOutput,
      ],
      input.shouldCancel,
    );
    await fs.rm(partialOutput, { force: true });
    await fs.rename(normalizedOutput, absoluteOutput);
    const [outputChecksum, media, outputLoudness] = await Promise.all([
      sha256File(absoluteOutput),
      probeMedia(input.outputPath),
      analyzeLoudness(
        executable,
        absoluteOutput,
        input.timeline.settings.loudnessTargetLufs,
        input.timeline.settings.truePeakDb,
        input.shouldCancel,
      ),
    ]);
    console.info("[composition.render]", JSON.stringify({
      event: "ffmpeg_succeeded",
      taskId: input.taskId,
      outputPath: input.outputPath,
      outputChecksum,
      durationMs: media?.durationMs ?? durationMs,
    }));
    return {
      outputPath: input.outputPath,
      outputChecksum,
      durationMs: media?.durationMs ?? durationMs,
      width: settings.width,
      height: settings.height,
      clipCount: clips.length,
      audioClipCount: [...audioLabelsByKind.values()].reduce((total, labels) => total + labels.length, 0),
      subtitleCueCount: subtitleCues.length,
      skippedAudio,
      renderLog: {
        renderer: "ffmpeg",
        executable,
        preset: input.preset,
        clipCount: clips.length,
        audioClipCount: [...audioLabelsByKind.values()].reduce((total, labels) => total + labels.length, 0),
        subtitleCueCount: subtitleCues.length,
        dialogueDucking: Boolean(dialogueBus && backgroundLabels.length),
        loudnessTargetLufs: input.timeline.settings.loudnessTargetLufs,
        truePeakDb: input.timeline.settings.truePeakDb,
        measuredLoudness,
        outputLoudness,
        skippedAudio,
        stderrTail: `${processResult.stderrTail}\n${normalizationResult.stderrTail}`.slice(-4_000),
      },
    };
  } catch (error) {
    await fs.rm(partialOutput, { force: true }).catch(() => undefined);
    await fs.rm(normalizedOutput, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all(subtitleOverlayFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
  }
}

function buildAudioFilter(inputLabel: string, clip: TimelineAudioClip, outputLabel: string): string {
  const filters = [
    `[${inputLabel}]atrim=duration=${seconds(clip.durationMs)}`,
    "asetpts=PTS-STARTPTS",
    "aresample=48000",
    "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
  ];
  if (clip.gainDb !== 0) filters.push(`volume=${clip.gainDb}dB`);
  if (clip.fadeInMs > 0) filters.push(`afade=t=in:st=0:d=${seconds(clip.fadeInMs)}`);
  if (clip.fadeOutMs > 0 && clip.durationMs > clip.fadeOutMs) {
    filters.push(`afade=t=out:st=${seconds(clip.durationMs - clip.fadeOutMs)}:d=${seconds(clip.fadeOutMs)}`);
  }
  if (clip.startMs > 0) filters.push(`adelay=${clip.startMs}:all=1`);
  return `${filters.join(",")}[${outputLabel}]`;
}

function wrapSubtitleText(value: string, maxCharacters: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  for (let index = 0; index < normalized.length; index += maxCharacters) {
    lines.push(normalized.slice(index, index + maxCharacters));
  }
  return lines.join("\n");
}

async function renderSubtitleOverlay(input: {
  outputPath: string;
  width: number;
  height: number;
  text: string;
  highQuality: boolean;
}): Promise<void> {
  const maxCharacters = input.height > input.width ? 14 : 24;
  const lines = wrapSubtitleText(input.text, maxCharacters).split("\n").slice(0, 3);
  const fontSize = input.highQuality ? Math.max(42, Math.round(input.width * 0.027)) : Math.max(26, Math.round(input.width * 0.033));
  const lineHeight = Math.round(fontSize * 1.35);
  const blockHeight = lineHeight * lines.length + Math.round(fontSize * 0.6);
  const y = Math.round(input.height * 0.84 - blockHeight / 2);
  const textStartY = y + Math.round(fontSize * 1.05);
  const tspans = lines
    .map((line, index) => `<tspan x="50%" y="${textStartY + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  const svg = `
    <svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="8%" y="${y}" width="84%" height="${blockHeight}" rx="10" fill="rgba(0,0,0,0.48)"/>
      <text text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif"
        font-size="${fontSize}" font-weight="600" fill="white" stroke="rgba(0,0,0,0.9)" stroke-width="2" paint-order="stroke">
        ${tspans}
      </text>
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(input.outputPath);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function analyzeLoudness(
  executable: string,
  mediaPath: string,
  targetLufs: number,
  truePeakDb: number,
  shouldCancel: () => Promise<boolean>,
): Promise<LoudnessStats | null> {
  const result = await runFfmpeg(
    executable,
    [
      "-hide_banner", "-nostdin", "-i", mediaPath,
      "-vn",
      "-af", `loudnorm=I=${targetLufs}:TP=${truePeakDb}:LRA=11:print_format=json`,
      "-f", "null", "-",
    ],
    shouldCancel,
  );
  const blocks = result.stderrTail.match(/\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/g);
  if (!blocks?.length) return null;
  try {
    const parsed = JSON.parse(blocks[blocks.length - 1]) as Record<string, string>;
    const stats: LoudnessStats = {
      inputI: Number(parsed.input_i),
      inputTp: Number(parsed.input_tp),
      inputLra: Number(parsed.input_lra),
      inputThresh: Number(parsed.input_thresh),
      targetOffset: Number(parsed.target_offset),
    };
    return Object.values(stats).every(Number.isFinite) ? stats : null;
  } catch {
    return null;
  }
}

function buildSecondPassLoudnessFilter(stats: LoudnessStats, targetLufs: number, truePeakDb: number): string {
  return (
    `loudnorm=I=${targetLufs}:TP=${truePeakDb}:LRA=11:` +
    `measured_I=${stats.inputI}:measured_TP=${stats.inputTp}:measured_LRA=${stats.inputLra}:` +
    `measured_thresh=${stats.inputThresh}:offset=${stats.targetOffset}:linear=true:print_format=summary`
  );
}
