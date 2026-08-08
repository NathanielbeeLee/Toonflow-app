import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const source = path.join(root, "frontend", "dist");
const target = path.join(root, "data", "web");
const staging = path.join(root, "data", `.web-next-${process.pid}`);
const backup = path.join(root, "data", `.web-backup-${process.pid}`);

if (!fs.existsSync(path.join(source, "index.html"))) {
  throw new Error("frontend/dist/index.html 不存在，请先运行 yarn frontend:build");
}
if (fs.existsSync(staging) || fs.existsSync(backup)) {
  throw new Error("前端同步临时目录已存在，请先确认没有另一个同步进程");
}

try {
  fs.cpSync(source, staging, { recursive: true });
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  fs.renameSync(staging, target);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
  console.log(`前端产物已同步到 ${target}`);
} catch (error) {
  if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  throw error;
}
