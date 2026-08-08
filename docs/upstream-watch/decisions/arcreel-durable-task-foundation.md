# 决策：吸收 ArcReel 持久任务可靠性底座

- 日期：2026-08-08
- 来源扫描修订：`d544f6137b289a648b391848f5311a0320187a74`
- 参考证据：`lib/generation_queue.py`、`lib/db/repositories/task_repo.py`、`lib/generation_worker.py`
- 结论：采纳设计，独立重写，不复制 AGPL 源码。

## 原因

Toonflow 原批量视频接口在响应后直接启动所有 Promise，应用退出即丢运行上下文，也没有资源占用去重、lease 或付费边界保护。这是自动出片链最先需要解决的可靠性风险。

## Toonflow 实现差异

保留 SQLite/Knex/TypeScript 单应用架构；兼容写入原 `o_tasks` 和 `o_video`。在 provider job ID 尚不可见时，不声称能够无损恢复远端轮询，而是将未知状态停在人工确认，优先避免重复扣费。

## 后续

先为一个代表视频 provider 拆出 `submit/poll/resume/cancel`，验证后再扩展供应商并发池和费用账本。

## 2026-08-08 跟进

单条视频生成也迁入同一 `video.generate` 任务类型，保持原 API 返回 `videoId`。单条和批量入口现在共享资源占用去重、并发、恢复和状态语义，不再存在两套执行逻辑。
