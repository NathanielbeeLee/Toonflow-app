# AI 接手速读

1. 读根目录 `AGENTS.md`、`IMPLEMENTATION_PROGRESS.md` 和本知识中心 README。
2. 回答功能问题时先查 `feature-catalog.md` / `workflows.md`，再核对 `knowledge-map.yaml` 指向的当前源码。
3. 涉及参考项目更新时读 `docs/upstream-watch/sources.yaml` 与最新 report；只从游标之后增量扫描。
4. 修改业务功能时同步更新知识节点、专题文档、实施进度和上游吸收记录。
5. 用用户看到的页面名称和状态讲解；必要时再补 API、表和源码路径。

当前真实边界：持久任务已接入单条/批量视频、批量资产图和批量分镜图；普通火山引擎、OpenAI 标准接口和 MiniMax 海螺支持 job ID 续跑，任务中心可操作任务并配置供应商/模型限流。单张图片编辑入口、TTS、合成和 QA 尚未接入；可灵等其他视频 vendor 仍多把提交和轮询封装为一次调用。`manual_review` 是状态不明时防重复付费的安全停点。CLIProxyAPI 当前只列出文本与 GPT Image 模型，未配置可用视频凭据，不能描述为已实测视频生成。`data/web` 只能由 `frontend/` 构建同步。
