import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import u from "@/utils";
import { NormalizedTimeline } from "@/services/composition/timeline";
import { probeMedia } from "@/services/media/probe";

export const compositionRenderPresets = ["preview-low"] as const;
export type CompositionRenderPreset = (typeof compositionRenderPresets)[number];

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

function seconds(milliseconds: number): string {
  return (Math.max(1, milliseconds) / 1000).toFixed(3);
}

function previewDimensions(timeline: NormalizedTimeline) {
  return timeline.settings.height > timeline.settings.width
    ? { width: 480, height: 854 }
    : { width: 854, height: 480 };
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
  if (input.preset !== "preview-low") throw new Error(`不支持的渲染预设: ${input.preset}`);
  const clips = input.timeline.videoTracks.flatMap((track) => track.clips).sort((a, b) => a.startMs - b.startMs);
  if (clips.length === 0) throw new Error("时间线没有可渲染的视频片段，请先在制作工作台完成选片并重新构建时间线");

  const absoluteInputs: string[] = [];
  for (const clip of clips) {
    const absolutePath = await u.oss.getAbsolutePath(clip.path);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) throw new Error(`视频片段不存在: ${clip.path}`);
    absoluteInputs.push(absolutePath);
  }

  const absoluteOutput = await u.oss.getAbsolutePath(input.outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const partialOutput = `${absoluteOutput}.partial-${input.taskId}.mp4`;
  await fs.rm(partialOutput, { force: true });
  const dimensions = previewDimensions(input.timeline);
  const filterParts = clips.map((clip, index) =>
    `[${index}:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,` +
      `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `fps=${input.timeline.settings.fps},setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
  );
  filterParts.push(`${clips.map((_, index) => `[v${index}]`).join("")}concat=n=${clips.length}:v=1:a=0[vout]`);

  const args: string[] = ["-hide_banner", "-nostdin", "-y"];
  clips.forEach((clip, index) => {
    args.push("-ss", seconds(clip.inMs), "-t", seconds(clip.durationMs), "-i", absoluteInputs[index]);
  });
  const durationMs = clips.reduce((total, clip) => total + clip.durationMs, 0);
  const silentAudioIndex = clips.length;
  args.push(
    "-f", "lavfi",
    "-t", seconds(durationMs),
    "-i", `anullsrc=channel_layout=stereo:sample_rate=${input.timeline.settings.audioSampleRate}`,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    "-map", `${silentAudioIndex}:a:0`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k",
    "-ar", String(input.timeline.settings.audioSampleRate),
    "-shortest",
    "-movflags", "+faststart",
    partialOutput,
  );

  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  console.info("[composition.render]", JSON.stringify({
    event: "ffmpeg_started",
    taskId: input.taskId,
    preset: input.preset,
    clipCount: clips.length,
    durationMs,
    width: dimensions.width,
    height: dimensions.height,
  }));
  try {
    const processResult = await runFfmpeg(executable, args, input.shouldCancel);
    await fs.rename(partialOutput, absoluteOutput);
    const [outputChecksum, media] = await Promise.all([sha256File(absoluteOutput), probeMedia(input.outputPath)]);
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
      width: dimensions.width,
      height: dimensions.height,
      clipCount: clips.length,
      renderLog: {
        renderer: "ffmpeg",
        executable,
        preset: input.preset,
        clipCount: clips.length,
        stderrTail: processResult.stderrTail.slice(-4_000),
      },
    };
  } catch (error) {
    await fs.rm(partialOutput, { force: true }).catch(() => undefined);
    throw error;
  }
}
