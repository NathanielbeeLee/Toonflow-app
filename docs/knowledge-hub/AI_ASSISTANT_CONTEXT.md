# AI 接手速读

1. 读根目录 `AGENTS.md`、`IMPLEMENTATION_PROGRESS.md` 和本知识中心 README。
2. 回答功能问题时先查 `feature-catalog.md` / `workflows.md`，再核对 `knowledge-map.yaml` 指向的当前源码。
3. 涉及参考项目更新时读 `docs/upstream-watch/sources.yaml` 与最新 report；只从游标之后增量扫描。
4. 修改业务功能时同步更新知识节点、专题文档、实施进度和上游吸收记录。
5. 用用户看到的页面名称和状态讲解；必要时再补 API、表和源码路径。

当前真实边界：持久任务已接入单条/批量视频、批量资产图、批量分镜图和逐句 TTS；普通火山引擎、OpenAI 标准接口、MiniMax 海螺和可灵视频支持远端任务续跑，任务中心可操作任务并配置供应商/模型限流。“配音与字幕”页面已支持角色音色、确定性台词解析、逐句入队、字幕 cue 与 SRT/VTT，但现有供应商模板的 `ttsRequest` 仍是空占位，不能描述为已支持真实配音。单张图片编辑、规范化时间线、合成和 QA 尚未接入；其余视频 vendor 仍多把提交和轮询封装为一次调用。`manual_review` 是状态不明时防重复付费的安全停点。CLIProxyAPI 当前只列出文本与 GPT Image 模型，未配置可用视频凭据，不能描述为已实测视频生成。`data/web` 只能由 `frontend/` 构建同步。
