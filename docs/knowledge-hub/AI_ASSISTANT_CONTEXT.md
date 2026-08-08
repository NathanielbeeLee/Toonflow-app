# AI 接手速读

1. 读根目录 `AGENTS.md`、`IMPLEMENTATION_PROGRESS.md` 和本知识中心 README。
2. 回答功能问题时先查 `feature-catalog.md` / `workflows.md`，再核对 `knowledge-map.yaml` 指向的当前源码。
3. 涉及参考项目更新时读 `docs/upstream-watch/sources.yaml` 与最新 report；只从游标之后增量扫描。
4. 修改业务功能时同步更新知识节点、专题文档、实施进度和上游吸收记录。
5. 用用户看到的页面名称和状态讲解；必要时再补 API、表和源码路径。

当前真实边界：持久任务已接入单条/批量视频、批量资产图、批量分镜图、逐句 TTS、本地 FFmpeg 成片和媒体 QA；普通火山引擎、OpenAI 标准接口、MiniMax 海螺和可灵视频支持远端任务续跑，任务中心可操作任务并配置供应商/模型限流。“配音与字幕”页面已支持角色音色、确定性台词解析、逐句入队、字幕 cue、SRT/VTT、声音素材和规范化时间线；OpenAI 标准供应商已支持 `/audio/speech` 真实 TTS，其他供应商仍多为空占位。时间线含视频/native/dialogue/narration/SFX/ambience/BGM/字幕分轨、版本和校验和，可渲染低清或高清 H.264/AAC，带 dialogue ducking、两遍 -16 LUFS/-1.5 dBTP 和字幕烧录。媒体 QA 覆盖编码/尺寸/时长、黑帧、冻结帧、静音、响度、字幕和流程警告；预算/审核、单张图片持久任务仍未完成。`manual_review` 是状态不明时防重复付费的安全停点，本地 FFmpeg/QA 不使用该付费边界。CLIProxyAPI 的视频和 TTS 能力均取决于代理真实凭据/路由。`data/web` 只能由 `frontend/` 构建同步。
