# 决策：吸收 ArcReel 的供应商任务身份锁定与恢复原则

- 日期：2026-08-08
- 来源扫描修订：`d544f6137b289a648b391848f5311a0320187a74`
- 参考证据：`lib/generation_queue.py` 的 `persist_provider_job_id`、执行身份锁定和 resume 路径
- 结论：采纳设计，先以普通火山引擎验证可选 adapter 契约。

## Toonflow 实现

供应商可选导出 `videoSubmit`、`videoPoll`、`videoCancel`；旧 `videoRequest` 不变。任务提交拿到 job ID 后立即写入 `generation_tasks`，随后才进入 polling。重启、轮询网络错误和本地结果保存错误均复用 job ID，不重新提交。

只在供应商有明确远端取消接口时实现 `videoCancel`。普通火山引擎本批未猜测取消接口，取消仍以本地停止轮询为主。

## 风险边界

远端已接受请求但客户端没有收到 job ID，或收到 job ID 后数据库写入失败，仍属于无法自动证明的状态，必须人工确认。这个窗口不能被虚假“幂等”承诺掩盖。
