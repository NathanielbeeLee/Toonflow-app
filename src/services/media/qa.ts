import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import u from "@/utils";
import { NormalizedTimeline } from "@/services/composition/timeline";

const execFileAsync = promisify(execFile);

export type QaSeverity = "info" | "warning" | "error";
export interface QaFinding {
  code: string;
  category: "media" | "video" | "audio" | "subtitle" | "workflow";
  severity: QaSeverity;
  message: string;
  startMs?: number;
  endMs?: number;
}

interface ProbeData {
  format?: { duration?: string; size?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
  }>;
}

function parseRate(value?: string): number | null {
  if (!value) return null;
  const parts = value.split("/");
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1] ?? 1);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

async function runAnalysis(executable: string, args: string[]): Promise<string> {
  const { stderr } = await execFileAsync(executable, args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  return stderr;
}

export async function inspectMediaQuality(input: {
  outputPath: string;
  timeline: NormalizedTimeline;
  expectedDurationMs: number;
  preset: string;
}) {
  const absolutePath = await u.oss.getAbsolutePath(input.outputPath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile() || stat.size === 0) throw new Error("成片文件不存在或为空");
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const { stdout } = await execFileAsync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels", "-of", "json", absolutePath],
    { timeout: 30_000, maxBuffer: 256 * 1024 },
  );
  const probe = JSON.parse(stdout) as ProbeData;
  const findings: QaFinding[] = [];
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(Number(probe.format?.duration || 0) * 1000);
  const expectedWidth = input.preset === "final-high"
    ? input.timeline.settings.width
    : input.timeline.settings.height > input.timeline.settings.width ? 480 : 854;
  const expectedHeight = input.preset === "final-high"
    ? input.timeline.settings.height
    : input.timeline.settings.height > input.timeline.settings.width ? 854 : 480;
  if (!video) findings.push({ code: "VIDEO_STREAM_MISSING", category: "media", severity: "error", message: "成片缺少视频流" });
  if (!audio) findings.push({ code: "AUDIO_STREAM_MISSING", category: "media", severity: "error", message: "成片缺少音频流" });
  if (video && video.codec_name !== "h264") findings.push({ code: "VIDEO_CODEC", category: "media", severity: "error", message: `视频编码为 ${video.codec_name || "未知"}，期望 H.264` });
  if (audio && audio.codec_name !== "aac") findings.push({ code: "AUDIO_CODEC", category: "media", severity: "error", message: `音频编码为 ${audio.codec_name || "未知"}，期望 AAC` });
  if (video && (video.width !== expectedWidth || video.height !== expectedHeight)) {
    findings.push({ code: "RESOLUTION_MISMATCH", category: "video", severity: "error", message: `分辨率 ${video.width}×${video.height}，期望 ${expectedWidth}×${expectedHeight}` });
  }
  const fps = parseRate(video?.avg_frame_rate);
  if (fps != null && Math.abs(fps - input.timeline.settings.fps) > 0.1) {
    findings.push({ code: "FPS_MISMATCH", category: "video", severity: "warning", message: `帧率 ${fps.toFixed(2)}，时间线目标 ${input.timeline.settings.fps}` });
  }
  if (audio?.sample_rate && Number(audio.sample_rate) !== input.timeline.settings.audioSampleRate) {
    findings.push({ code: "SAMPLE_RATE_MISMATCH", category: "audio", severity: "warning", message: `音频采样率 ${audio.sample_rate}Hz，目标 ${input.timeline.settings.audioSampleRate}Hz` });
  }
  if (Math.abs(durationMs - input.expectedDurationMs) > 250) {
    findings.push({ code: "DURATION_MISMATCH", category: "media", severity: "error", message: `成片时长 ${durationMs}ms，与时间线 ${input.expectedDurationMs}ms 相差超过 250ms` });
  }

  const [blackLog, freezeLog, silenceLog, loudnessLog] = await Promise.all([
    runAnalysis(ffmpeg, ["-hide_banner", "-nostdin", "-i", absolutePath, "-an", "-vf", "blackdetect=d=0.5:pix_th=0.10", "-f", "null", "-"]),
    runAnalysis(ffmpeg, ["-hide_banner", "-nostdin", "-i", absolutePath, "-an", "-vf", "freezedetect=n=-60dB:d=1.5", "-f", "null", "-"]),
    runAnalysis(ffmpeg, ["-hide_banner", "-nostdin", "-i", absolutePath, "-vn", "-af", "silencedetect=n=-50dB:d=0.8", "-f", "null", "-"]),
    runAnalysis(ffmpeg, ["-hide_banner", "-nostdin", "-i", absolutePath, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]),
  ]);
  for (const match of blackLog.matchAll(/black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g)) {
    findings.push({ code: "BLACK_FRAME", category: "video", severity: Number(match[3]) >= 1.5 ? "error" : "warning", message: `检测到 ${Number(match[3]).toFixed(2)} 秒黑帧`, startMs: Math.round(Number(match[1]) * 1000), endMs: Math.round(Number(match[2]) * 1000) });
  }
  const freezeStarts = [...freezeLog.matchAll(/freeze_start:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const freezeDurations = [...freezeLog.matchAll(/freeze_duration:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  freezeStarts.forEach((start, index) => {
    const duration = freezeDurations[index] ?? 1.5;
    findings.push({ code: "FREEZE_FRAME", category: "video", severity: duration >= 3 ? "error" : "warning", message: `检测到约 ${duration.toFixed(2)} 秒冻结画面`, startMs: Math.round(start * 1000), endMs: Math.round((start + duration) * 1000) });
  });
  for (const match of silenceLog.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)[\s\S]*?silence_end:\s*(\d+(?:\.\d+)?)/g)) {
    const silenceDuration = Number(match[2]) - Number(match[1]);
    findings.push({ code: "SILENCE", category: "audio", severity: silenceDuration >= 3 ? "error" : "warning", message: `检测到 ${silenceDuration.toFixed(2)} 秒静音`, startMs: Math.round(Number(match[1]) * 1000), endMs: Math.round(Number(match[2]) * 1000) });
  }
  const loudnessBlock = loudnessLog.match(/\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/)?.[0];
  let integratedLufs: number | null = null;
  let truePeakDb: number | null = null;
  if (loudnessBlock) {
    const values = JSON.parse(loudnessBlock) as Record<string, string>;
    integratedLufs = Number(values.input_i);
    truePeakDb = Number(values.input_tp);
    if (Number.isFinite(integratedLufs) && Math.abs(integratedLufs - input.timeline.settings.loudnessTargetLufs) > 1) {
      findings.push({ code: "LOUDNESS_OUT_OF_RANGE", category: "audio", severity: "warning", message: `综合响度 ${integratedLufs.toFixed(1)} LUFS，目标 ${input.timeline.settings.loudnessTargetLufs}±1 LUFS` });
    }
    if (Number.isFinite(truePeakDb) && truePeakDb > input.timeline.settings.truePeakDb + 0.1) {
      findings.push({ code: "TRUE_PEAK_EXCEEDED", category: "audio", severity: "error", message: `True peak ${truePeakDb.toFixed(1)} dBTP，超过 ${input.timeline.settings.truePeakDb} dBTP` });
    }
  }
  for (const cue of input.timeline.subtitleTracks.flatMap((track) => track.cues)) {
    const durationSeconds = Math.max(0.1, (cue.endMs - cue.startMs) / 1000);
    const charactersPerSecond = cue.text.replace(/\s/g, "").length / durationSeconds;
    if (charactersPerSecond > 12) findings.push({ code: "SUBTITLE_READING_SPEED", category: "subtitle", severity: charactersPerSecond > 18 ? "error" : "warning", message: `字幕阅读速度 ${charactersPerSecond.toFixed(1)} 字/秒，建议不超过 12`, startMs: cue.startMs, endMs: cue.endMs });
    const maxCharacters = input.timeline.settings.height > input.timeline.settings.width ? 42 : 72;
    if (cue.text.replace(/\s/g, "").length > maxCharacters) findings.push({ code: "SUBTITLE_SAFE_AREA", category: "subtitle", severity: "warning", message: "字幕超过三行安全区容量，烧录时会截断", startMs: cue.startMs, endMs: cue.endMs });
  }
  input.timeline.warnings.forEach((message) => findings.push({ code: "TIMELINE_WARNING", category: "workflow", severity: "warning", message }));
  return {
    summary: {
      status: findings.some((finding) => finding.severity === "error") ? "failed" : findings.some((finding) => finding.severity === "warning") ? "warning" : "passed",
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      durationMs,
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
      fileSize: Number(probe.format?.size ?? stat.size),
      integratedLufs: Number.isFinite(integratedLufs) ? integratedLufs : null,
      truePeakDb: Number.isFinite(truePeakDb) ? truePeakDb : null,
    },
    findings,
  };
}
