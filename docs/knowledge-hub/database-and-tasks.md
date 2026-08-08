# 数据库与任务

`generation_tasks` 是新任务事实源，`o_tasks`/`o_video` 仍同步状态供旧页面读取。关键字段：

- `payload`：版本化任务输入，只保存本地业务数据和模型名，不应保存 API Key。
- `resource_key`：同一轨道活动任务占用，防止重复点击。
- `idempotency_key`：客户端 requestId 与资源组合的稳定哈希。
- `lease_owner/lease_expires_at`：worker 所有权与崩溃接管边界。
- `attempts/max_attempts/next_run_at`：有限退避重试。
- `provider_job_id`：供应商提交后立即保存的远端任务编号。普通火山引擎已支持；其他供应商逐步接入。

状态主线：`queued → claimed → submitting → submitted → polling → finalizing → succeeded`。有远端任务编号时，轮询失败、保存失败或应用重启会重新排队并恢复同一任务；没有编号的付费边界不确定错误进入 `manual_review`。取消使用 `cancelling/cancelled`。
