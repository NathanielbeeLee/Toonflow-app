import { execFile } from "node:child_process";
import { promisify } from "node:util";
import u from "@/utils";

const execFileAsync = promisify(execFile);

export interface MediaProbe {
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probeMedia(userPath: string): Promise<MediaProbe | null> {
  const absolutePath = await u.oss.getAbsolutePath(userPath);
  const executable = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  try {
    const { stdout } = await execFileAsync(
      executable,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", absolutePath],
      { timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
    const seconds = Number(data.format?.duration);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return {
      durationMs: Math.max(1, Math.round(seconds * 1000)),
      hasAudio: Boolean(data.streams?.some((stream) => stream.codec_type === "audio")),
      hasVideo: Boolean(data.streams?.some((stream) => stream.codec_type === "video")),
    };
  } catch (error) {
    console.warn("[媒体探测] ffprobe 不可用或文件无法探测:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
