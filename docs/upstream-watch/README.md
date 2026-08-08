# 参考上游持续吸收

这里是跨项目能力吸收的审计台账。`sources.yaml` 同时记录“已经扫描到哪里”和“实际吸收到哪里”，两者不能混用。

## 每次执行

1. 确认在 `toon-custom`，保护工作区未知修改。
2. 运行 `yarn upstream:check` 校验本地参考仓库与游标。
3. 运行 `yarn upstream:scan` 获取从 `last_scanned_commit` 到最新远端的只读差异。
4. 阅读新增代码、schema、UI 和测试，按成片质量、可靠性、效率、适配度、维护成本、安全性评分。
5. 高价值能力按 Toonflow 的 TypeScript/SQLite/Vue 架构重写；不直接拼入第二套服务。
6. 完成验证后更新当日报告、decision、`sources.yaml`、实施交接和知识地图。

`last_scanned_commit` 在一次来源扫描和报告完成后更新；`last_adopted_commit` 只有实际功能落地并验证后才更新。参考源码统一放在 `/Users/jiulongpopengyuyan/Desktop/cloudstar/project/ohter2`。

## 许可证纪律

ArcReel 与 OpenMontage 是 AGPL-3.0，huobao-drama 当前没有许可证文件。本项目默认只学习公开行为和架构并独立重写，禁止直接复制这些仓库的源码。每轮以真实许可证文件为准重新核对。
