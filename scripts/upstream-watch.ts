import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Source {
  id: string;
  local_path: string;
  tracking_ref: string;
  last_scanned_commit: string;
}

interface SourcesFile {
  schema_version: number;
  source_root: string;
  sources: Source[];
}

const file = path.join(process.cwd(), "docs/upstream-watch/sources.yaml");
const config = JSON.parse(fs.readFileSync(file, "utf8")) as SourcesFile;

function git(source: Source, args: string[], allowFailure = false): string {
  const result = spawnSync("git", ["-C", source.local_path, ...args], { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) throw new Error(`${source.id}: git ${args.join(" ")} 失败：${result.stderr.trim()}`);
  return result.stdout.trim();
}

function check(): void {
  const errors: string[] = [];
  for (const source of config.sources) {
    if (!path.resolve(source.local_path).startsWith(path.resolve(config.source_root) + path.sep)) {
      errors.push(`${source.id}: local_path 不在统一源码目录中`);
      continue;
    }
    if (!fs.existsSync(path.join(source.local_path, ".git"))) {
      errors.push(`${source.id}: 本地仓库不存在 ${source.local_path}`);
      continue;
    }
    if (!git(source, ["rev-parse", "--verify", `${source.last_scanned_commit}^{commit}`], true)) {
      errors.push(`${source.id}: last_scanned_commit 在本地不可解析`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`参考上游台账校验通过，共 ${config.sources.length} 个来源`);
}

function scan(): void {
  check();
  for (const source of config.sources) {
    git(source, ["fetch", "origin", "--prune", "--tags"]);
    const latest = git(source, ["rev-parse", source.tracking_ref]);
    const count = git(source, ["rev-list", "--count", `${source.last_scanned_commit}..${latest}`]);
    console.log(`\n[${source.id}] ${source.last_scanned_commit.slice(0, 8)} -> ${latest.slice(0, 8)}，新增 ${count} 个提交`);
    if (count !== "0") console.log(git(source, ["log", "--oneline", "--no-merges", `${source.last_scanned_commit}..${latest}`]));
  }
  console.log("\n扫描是只读的；由 Codex 评估并实施后，再更新 sources.yaml 和扫描报告。 ");
}

try {
  if ((process.argv[2] ?? "check") === "scan") scan();
  else check();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
