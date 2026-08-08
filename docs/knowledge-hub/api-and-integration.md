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

正式版本化 OpenAPI、API Key、webhook 尚未实现。当前接口不应直接暴露到公网。
