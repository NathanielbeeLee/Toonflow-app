# 上游基线

| 类型 | 仓库 | 分支/标签 | 当前修订 | 用途 |
| --- | --- | --- | --- | --- |
| 代码上游 | HBAI-Ltd/Toonflow-app | master | `bc61ec7a1b5df31293b286981a5f4ad4635464ee` | 后端/Electron 主线 |
| 用户 fork | NathanielbeeLee/Toonflow-app | master | `bc61ec7a1b5df31293b286981a5f4ad4635464ee` | GitHub Sync fork 目标 |
| 自定义主线 | NathanielbeeLee/Toonflow-app | toon-custom | 基线 `13e8e46eb537f8c4f1076796d96904cef03bc9d0` | 长期定制与能力吸收 |
| 正式版本 | HBAI-Ltd/Toonflow-app | v1.1.8 | `cd3e7c4e83963bea255be2e621eb78d2cd1c2188` | 当前发布基线 |
| 前端代码上游 | HBAI-Ltd/Toonflow-web | master | `9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214` | 已以 squash subtree 纳入 `frontend/` |

2026-08-08 复核：`v1.1.8` 是 `upstream/master` 的祖先，master 领先 6 个提交；三方 master 无分叉。因此从 master 建立并长期 merge 到 `toon-custom` 的策略有效。

2026-08-08 前端首次纳入：subtree 导入提交 `a631d1fc`，构建接线与兼容提交 `eee77980`。后续只扫描/同步 Toonflow-web `9c4cb0e` 之后的提交，详见 `docs/frontend-upstream.md`。

同步 fork 后，本地建议：

```bash
git fetch origin upstream --prune --tags
git switch toon-custom
git merge --no-ff origin/master
git push origin toon-custom
```
