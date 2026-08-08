# Toonflow Custom 实施交接

> 最后更新：2026-08-08；当前分支：`toon-custom`

## 当前基线

- Toonflow-app 原仓库 `upstream/master`：`bc61ec7a1b5df31293b286981a5f4ad4635464ee`。
- 用户 fork `origin/master`：同为 `bc61ec7a1b5df31293b286981a5f4ad4635464ee`。
- `v1.1.8` 为上游 master 祖先，master 领先 6 个仅文档/图片提交。
- 自定义分支已有基线提交 `13e8e46eb537f8c4f1076796d96904cef03bc9d0`，包含调研计划与 Serena 配置。
- 实施前 3 个 vendor 文件工作树哈希与 HEAD 完全一致；未覆盖。`CUSTOM_AI_VIDEO_STUDIO_IMPLEMENTATION_PLAN.md` 有用户未提交修改，本轮不改该文件。

## 2026-08-08 首次能力吸收

目标：建立可持续吸收台账、项目知识地图，并从 ArcReel 重写第一批持久任务可靠性能力。

落地提交：`9282f95`（已推送 `origin/toon-custom`）。

已实现：

- 版本化数据库迁移入口及 `generation_tasks`、依赖、供应商限制、费用账本、项目事件表。
- 批量视频生成从“HTTP 返回后无限并发 Promise”改为 SQLite 持久队列，带资源占用去重、幂等请求 ID、有限并发、lease、取消、退避和重启恢复。
- 供应商现有接口不能暴露 job ID 时，越过付费提交边界的异常或重启不自动重提，进入 `manual_review` 防重复扣费。
- 新增任务查询、取消、人工确认后重试 API；保留旧 `o_tasks` 和 `o_video` 状态供现有页面兼容读取。
- 建立参考上游扫描游标、扫描报告、采纳决策、项目指南和可生成索引的知识地图。

明确限制：

- 单条和批量视频入口均已切入持久队列；图片和 TTS 仍走旧执行路径。
- 现有 vendor 模板把 submit/poll 合成一次调用，尚不能保存并恢复 `provider_job_id`，也不能普遍执行远端取消。
- 任务中心新 UI、费用实际记账、逐句配音、多轨合成和 QA 尚未实现；不可对外宣称完整自动出片链已完成。

## 验证记录

- `tsc --noEmit`：通过。
- `git diff --check`：通过。
- 数据库迁移在内存 SQLite 连续执行两次：6 张目标表存在，迁移记录仍为 1 条，重复执行安全。
- 未调用任何文本、图片、视频、TTS 付费 API。

## 2026-08-08 第二批：供应商任务 ID 恢复

目标：把第一批“付费边界后只能人工确认”推进为对支持供应商可自动恢复轮询。

落地提交：`d5eca2c`（已推送 `origin/toon-custom`）。

已实现：

- 定义兼容旧 vendor 的可选 `videoSubmit/videoPoll/videoCancel` 契约。
- 普通火山引擎拆分提交与轮询，提交后把远端 job ID 持久化，再进入 polling。
- 应用重启、查询网络错误、轮询超时和本地保存错误会复用 job ID，不重新付费提交。
- worker 每 15 秒回收一次过期 lease，解决应用启动时 lease 尚未过期而之后无人接管的问题。
- 增加完全本地的火山适配器 Mock 验证；未调用真实 API。

仍有安全停点：远端接受请求但客户端未收到 job ID，或 job ID 写库前失败，无法证明远端状态，继续进入人工确认。`volcengineSd2` 与其他供应商尚未接入恢复契约。

## 2026-08-08 第三批：统一单条/批量视频入口

落地提交：`3551338`（已推送 `origin/toon-custom`）。

- 单条 `/production/workbench/generateVideo` 改为调用同一持久入队服务。
- 保持原响应仍为 `videoId`，现有 Toonflow-web 无需修改即可继续轮询视频结果。
- 单条与批量请求共享轨道资源占用；已有活动任务时复用同一 `videoId`，避免按钮重复点击造成重复提交。
- 移除单条入口中独立的后台 Promise、引用图提前转 base64 和重复旧任务记录逻辑。

## 2026-08-08 第四批：纳入可维护前端源码

上游基线：HBAI-Ltd/Toonflow-web `9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214`。

落地提交：`a631d1fc`（subtree 导入）和 `eee77980`（构建接线与兼容修复）。

- 以 squash subtree 把完整 Vue 前端纳入 `frontend/`，后续可以从上述修订之后增量同步，而不再只能修改压缩后的 `data/web/index.html`。
- 根项目新增前端安装、开发、构建和安全同步命令；`data/web` 明确改为构建产物，不允许手工修改。
- 修正首次独立构建暴露的自动导入声明顺序、主题类型、Vite 类型和少量组件契约问题；删除两个未引用且阻塞类型检查的备份页面。
- 根后端 TypeScript 检查与前端子工程隔离，前端由自己的 Vite/`vue-tsc` 配置验证。
- 无限画布不是“无限生成”或“无限存储”，而是可缩放、可平移、可拖动节点的空间式生产界面；当前节点覆盖剧本、导演计划、资产、分镜表、分镜和视频工作台。

验证：`yarn frontend:build`、`yarn frontend:sync`、根目录 `tsc --noEmit` 均通过。构建未调用任何 AI 或付费供应商 API。

## 下一批优先级

1. 基于已纳入的前端源码制作任务中心 UI，展示排队、重试、取消、人工确认和远端续跑状态。
2. 把批量图片迁入同一任务引擎，并增加按供应商/模型的并发和 RPM 限流。
3. 为更多视频供应商实现 `submit/poll/resume/cancel`，不支持远端取消的供应商继续保留本地取消边界。
4. 再吸收 Huobao 的逐句 TTS/角色音色和 OpenMontage 的规范化时间线、多轨混音与媒体 QA。

继续工作前先读：`docs/knowledge-hub/AI_ASSISTANT_CONTEXT.md`、`docs/upstream-watch/sources.yaml` 和最新扫描报告。
