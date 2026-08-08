# API 与集成

所有接口使用现有 JWT 登录鉴权。

| 接口 | 作用 |
| --- | --- |
| `POST /api/production/workbench/batchGenerateVideo` | 批量视频任务入队；可选 `requestId`，返回 `durableTaskId` |
| `POST /api/production/workbench/generateVideo` | 单条视频任务入队；保持返回原 `videoId`，可选 `requestId` |
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

正式版本化 OpenAPI、API Key、webhook 尚未实现。当前接口不应直接暴露到公网。配音接口已有后端能力，但前端页面和真实 TTS 供应商仍待接通。
