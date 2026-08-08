# 持续吸收固定提示词

在 Toonflow-app 的 `toon-custom` 分支执行一次参考上游持续吸收：保护现有工作区，读取 `AGENTS.md`、`IMPLEMENTATION_PROGRESS.md`、知识中心和 `docs/upstream-watch/sources.yaml`；运行上游校验与增量扫描；只吸收能提高成片质量、任务可靠性、费用安全或操作效率且适合 Toonflow 单项目架构的能力。不要整仓 merge/cherry-pick 参考项目，不引入第二套运行时，不调用付费 API。每项落地后更新扫描报告、decision、游标、实施交接和知识地图，并做与风险相称的验证。
