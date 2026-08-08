import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import u from "@/utils";
import { db } from "@/utils/db";

const execFileAsync = promisify(execFile);

async function toolVersion(executable: string) {
  try {
    const { stdout } = await execFileAsync(executable, ["-version"], { timeout: 10_000, maxBuffer: 64 * 1024 });
    return { available: true, version: stdout.split(/\r?\n/)[0] };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function buildDiagnosticReport() {
  const dataPath = u.getPath();
  const [migrations, taskCounts, projectCount, tableRows, disk, ffmpeg, ffprobe] = await Promise.all([
    (db as any)("schema_migrations").select("id", "applied_at as appliedAt").orderBy("applied_at", "asc"),
    (db as any)("generation_tasks").select("lane", "status").count("* as total").groupBy("lane", "status"),
    (db as any)("o_project").count("* as total").first(),
    (db as any).raw("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"),
    fs.statfs(dataPath).catch(() => null),
    toolVersion(process.env.FFMPEG_PATH?.trim() || "ffmpeg"),
    toolVersion(process.env.FFPROBE_PATH?.trim() || "ffprobe"),
  ]);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: "不含密钥、密码、供应商地址、项目名称、剧本、提示词或生成媒体",
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: process.versions.electron ?? null,
      environment: process.env.NODE_ENV ?? null,
      listenHost: process.env.TOONFLOW_HOST?.trim() || "127.0.0.1",
    },
    mediaTools: { ffmpeg, ffprobe },
    storage: {
      dataPath,
      freeBytes: disk ? Number(disk.bavail) * Number(disk.bsize) : null,
      totalBytes: disk ? Number(disk.blocks) * Number(disk.bsize) : null,
    },
    database: {
      tables: (Array.isArray(tableRows) ? tableRows : []).map((row: any) => row.name),
      migrations,
      projectCount: Number(projectCount?.total ?? 0),
    },
    durableTasks: taskCounts.map((row: any) => ({ lane: row.lane, status: row.status, total: Number(row.total) })),
    configurationPresence: {
      customFfmpegPath: Boolean(process.env.FFMPEG_PATH?.trim()),
      customFfprobePath: Boolean(process.env.FFPROBE_PATH?.trim()),
      externalListenEnabled: !["127.0.0.1", "localhost", "::1"].includes(process.env.TOONFLOW_HOST?.trim() || "127.0.0.1"),
    },
  };
}
