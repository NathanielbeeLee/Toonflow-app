# 运维与升级

## 开发命令

```bash
yarn dev
yarn lint
yarn knowledge:check
yarn knowledge:build
yarn upstream:check
yarn upstream:scan
```

前端独立开发与发布：

```bash
yarn frontend:install
yarn frontend:dev
yarn frontend:build
yarn frontend:sync
```

只修改 `frontend/`；完整根构建会自动执行前端构建和同步。单独运行 `frontend:sync` 前必须先成功构建，它会通过临时目录交换 `data/web`，失败时恢复旧产物。上游增量同步命令和基线见 `docs/frontend-upstream.md`。

## 数据位置

- 浏览器/服务模式：仓库 `data/db2.sqlite` 与 `data/oss/`。
- Electron：系统 userData 下的 `data/db2.sqlite` 与 `data/oss/`。
- 前端运行产物：`data/web/`。

数据库升级由 `schema_migrations` 记录。操作真实数据库前先停止应用并复制 `db2.sqlite` 作为可恢复备份；不要在任务运行时删除数据库或媒体目录。

任务默认对同一供应商/模型/通道限制并发 2、RPM 10。可在“任务中心 → 供应商限流”写入 `provider_limits` 覆盖默认值；模型填 `*` 表示供应商在该通道的通用规则。环境变量 `TOONFLOW_PROVIDER_CONCURRENCY`、`TOONFLOW_PROVIDER_RPM` 只作为没有数据库规则时的默认值。

## 安全与诊断

服务默认只监听 `127.0.0.1`。确需局域网访问时设置 `TOONFLOW_HOST`，同时自行配置防火墙、TLS 反向代理和受限 CORS；不要直接把端口暴露到公网。

新安装首次用 `admin/admin123` 登录后必须立即修改密码；数据库只保存 scrypt 加盐哈希。旧数据库的明文密码会在一次成功登录后迁移。任务中心“导出诊断”下载脱敏 JSON，可用于排查运行时、媒体工具、磁盘、迁移和任务状态；报告不含密钥、密码、供应商地址或业务内容，提交给他人前仍应人工浏览。

## 上游升级

GitHub Sync fork 只更新用户 fork 的 master，不会自动更新本地或 `toon-custom`。同步后 fetch，再把 `origin/master` merge 到 `toon-custom`；共享分支不要破坏性 rebase。
