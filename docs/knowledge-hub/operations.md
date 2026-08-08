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

## 上游升级

GitHub Sync fork 只更新用户 fork 的 master，不会自动更新本地或 `toon-custom`。同步后 fetch，再把 `origin/master` merge 到 `toon-custom`；共享分支不要破坏性 rebase。
