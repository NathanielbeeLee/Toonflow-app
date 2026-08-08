# 数据库与任务

`generation_tasks` 是新任务事实源，`o_tasks`/`o_video` 仍同步状态供旧页面读取。关键字段：

- `payload`：版本化任务输入，只保存本地业务数据和模型名，不应保存 API Key。
- `resource_key`：同一轨道活动任务占用，防止重复点击。
- `idempotency_key`：客户端 requestId 与资源组合的稳定哈希。
- `lease_owner/lease_expires_at`：worker 所有权与崩溃接管边界。
- `attempts/max_attempts/next_run_at`：有限退避重试。
- `provider_job_id`：供应商提交后立即保存的远端任务身份。普通火山引擎、OpenAI 标准接口、MiniMax 和可灵已支持；可灵身份包含受控查询路径与 task ID。
- `provider_limits`：供应商/模型/通道级最大并发、RPM 和冷却时间；任务中心可维护，未配置时默认并发 2、RPM 10。

状态主线：`queued → claimed → submitting → submitted → polling → finalizing → succeeded`。有远端任务编号时，轮询失败、保存失败或应用重启会重新排队并恢复同一任务；没有编号的付费边界不确定错误进入 `manual_review`。取消使用 `cancelling/cancelled`。

用户可从左侧“任务中心 → 持久任务”查看这些字段的安全摘要，按项目、通道和状态筛选，并执行取消或重试。单条/批量视频、批量资产图和批量分镜图使用该事实源；原 `o_tasks` 记录位于“历史任务”页签。
