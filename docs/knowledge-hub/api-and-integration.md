# API 与集成

所有接口使用现有 JWT 登录鉴权。

| 接口 | 作用 |
| --- | --- |
| `POST /api/production/workbench/batchGenerateVideo` | 批量视频任务入队；可选 `requestId`，返回 `durableTaskId` |
| `POST /api/production/workbench/generateVideo` | 单条视频任务入队；保持返回原 `videoId`，可选 `requestId` |
| `POST /api/assetsGenerate/generateAssets` | 单张角色、场景或道具图片入队，返回持久任务与图片占位记录 |
| `POST /api/production/editImage/generateFlowImage` | 图片编辑画布节点入队，返回节点应保存的持久任务 ID |
| `POST /api/script/importNovel/preview` | 校验 AI Novel 小说/短剧 JSON 或本机 API，仅返回预览和计划动作 |
| `POST /api/script/importNovel/commit` | 按所选外部章节执行版本化幂等导入 |
| `POST /api/generationTasks/list` | 按项目、lane、状态、类型分页查询 |
| `POST /api/generationTasks/get` | 查询单个持久任务 |
| `POST /api/generationTasks/cancel` | 请求取消任务 |
| `POST /api/generationTasks/retry` | 重试失败/取消任务；人工确认态必须传确认字段 |
| `POST /api/voiceStudio/casts/list` / `upsert` | 查询或维护项目角色音色 |
| `POST /api/voiceStudio/utterances/import` | 从剧本确定性导入逐句台词；可选包含分镜描述 |
| `POST /api/voiceStudio/utterances/list` / `update` | 查询、编辑和锁定逐句台词 |
| `POST /api/voiceStudio/utterances/generate` / `batchGenerate` | 单句或批量进入持久 TTS 队列 |
| `POST /api/voiceStudio/cues/list` / `update` / `rebuild` | 查询、编辑、锁定或重建字幕 cue |
| `POST /api/voiceStudio/cues/export` | 输出 SRT 或 WebVTT 文本 |
| `POST /api/composition/timeline/build` | 从选片、逐句音频和字幕构建或复用规范化时间线版本 |
| `POST /api/composition/timeline/latest` / `list` | 获取最新时间线或版本历史 |
| `POST /api/composition/timeline/render` | 把指定时间线版本的 `preview-low` 本地渲染任务加入 `compose` 队列 |
| `POST /api/composition/timeline/jobs/latest` | 获取当前剧本最近一次合成任务、输出和错误状态 |
| `POST /api/composition/timeline/audio/list` / `upsert` / `delete` | 维护剧本时间线的 SFX、环境声和 BGM 片段 |
| `POST /api/composition/timeline/qa/run` | 对指定成功成片创建本地持久媒体 QA |
| `POST /api/composition/timeline/qa/latest` | 获取当前剧本最近一次 QA 状态和问题报告 |
| `POST /api/generationTasks/limits/budget/get` / `upsert` | 查询或维护项目预算与未知价格策略 |
| `POST /api/generationTasks/limits/pricing/list` / `upsert` / `delete` | 维护用户提供的模型价格规则 |
| `POST /api/composition/timeline/review/latest` / `record` | 查询或追加绑定成片 checksum 的审核记录 |
| `POST /api/setting/diagnostics/export` | 导出不含密钥和业务内容的本机脱敏诊断 JSON |

正式版本化 OpenAPI、API Key、webhook 尚未实现。当前接口不应直接暴露到公网。时间线渲染只调用本机 FFmpeg，不调用付费生成 API；请求必须使用服务端保存的 timeline ID，不能传入任意本机输入或输出路径。
