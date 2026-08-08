# Toonflow Custom 工作约定

回答项目功能或操作问题前，先读 `docs/knowledge-hub/README.md`，再按其中导航读取专题文档；涉及具体行为时仍须核对当前源码。

所有长期定制都在 `toon-custom` 分支完成。同步 Toonflow-app 上游使用 merge；ArcReel、OpenMontage、huobao-drama、MoneyPrinterTurbo 等只作为参考上游，禁止整仓 merge、cherry-pick 或变成运行时依赖。

吸收参考项目能力时必须同时更新：

- `docs/upstream-watch/sources.yaml` 的扫描游标；
- 当次 `docs/upstream-watch/reports/` 报告和采纳决策；
- `IMPLEMENTATION_PROGRESS.md`；
- 相关知识文档与 `knowledge-map.yaml`。

外部源码统一放在 `/Users/jiulongpopengyuyan/Desktop/cloudstar/project/ohter2`。未经当次明确授权，不调用任何付费生成 API，不提交密钥、数据库、私人剧本或生成媒体。
