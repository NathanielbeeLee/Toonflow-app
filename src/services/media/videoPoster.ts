import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import oss from "@/utils/oss";
import { normalizeError } from "@/utils/error";

const execFileAsync = promisify(execFile);
const inFlight = new Map<string, Promise<string | null>>();
const posterQueue: Array<() => void> = [];
let activePosterJobs = 0;
const MAX_POSTER_JOBS = 2;

function runNextPosterJob() {
  while (activePosterJobs < MAX_POSTER_JOBS && posterQueue.length) {
    activePosterJobs += 1;
    posterQueue.shift()?.();
  }
}

function withPosterSlot<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    posterQueue.push(() => {
      work()
        .then(resolve, reject)
        .finally(() => {
          activePosterJobs -= 1;
          runNextPosterJob();
        });
    });
    runNextPosterJob();
  });
}

export function videoPosterPathFor(videoPath: string): string {
  const normalized = videoPath.replace(/\\/g, "/");
  const extension = path.posix.extname(normalized);
  return extension ? `${normalized.slice(0, -extension.length)}.poster.jpg` : `${normalized}.poster.jpg`;
}

async function extractAt(source: string, target: string, timestamp: string): Promise<void> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await execFileAsync(
    executable,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      timestamp,
      "-i",
      source,
      "-frames:v",
      "1",
      "-an",
      "-vf",
      "scale='min(640,iw)':-2",
      "-q:v",
      "3",
      target,
    ],
    { timeout: 20_000, maxBuffer: 128 * 1024 },
  );
}

async function createVideoPoster(videoPath: string): Promise<string | null> {
  let partial: string | null = null;
  try {
    if (!/\.(mp4|mov|webm|mkv)$/i.test(videoPath) || !(await oss.fileExists(videoPath))) return null;
    const posterPath = videoPosterPathFor(videoPath);
    if (await oss.fileExists(posterPath)) return posterPath;

    const source = await oss.getAbsolutePath(videoPath);
    const target = await oss.getAbsolutePath(posterPath);
    partial = target.replace(/\.jpg$/i, ".partial.jpg");
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await extractAt(source, partial, "0.5");
    } catch {
      await fs.rm(partial, { force: true });
      await extractAt(source, partial, "0");
    }
    const stat = await fs.stat(partial);
    if (!stat.isFile() || stat.size === 0) throw new Error("FFmpeg 没有输出海报帧");
    await fs.rename(partial, target);
    return posterPath;
  } catch (error) {
    if (partial) await fs.rm(partial, { force: true }).catch(() => {});
    console.warn(`[视频海报帧] ${videoPath} 生成失败:`, normalizeError(error).message);
    return null;
  }
}

export function ensureVideoPoster(videoPath: string): Promise<string | null> {
  const existing = inFlight.get(videoPath);
  if (existing) return existing;
  const pending = withPosterSlot(() => createVideoPoster(videoPath)).finally(() => inFlight.delete(videoPath));
  inFlight.set(videoPath, pending);
  return pending;
}

export async function getVideoPresentation(videoPath: string): Promise<{ src: string; posterSrc: string }> {
  const src = await oss.getFileUrl(videoPath);
  const posterPath = videoPosterPathFor(videoPath);
  try {
    if (await oss.fileExists(posterPath)) {
      return { src, posterSrc: await oss.getFileUrl(posterPath) };
    }
    void ensureVideoPoster(videoPath);
  } catch (error) {
    console.warn(`[视频海报帧] ${videoPath} 查询失败:`, normalizeError(error).message);
  }
  return { src, posterSrc: "" };
}
