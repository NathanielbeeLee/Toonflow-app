# Toonflow 项目知识中心

这里是“项目功能地图”的入口。它不是用一张大图替代代码，而是把功能、页面、接口、数据表、源码和故障处理关联起来，让用户和未来 Codex 能快速回答“有什么、怎么用、出错去哪看”。

## 按问题导航

- 想了解产品能做什么：读 `feature-catalog.md`。
- 想知道从小说到视频怎么操作：读 `workflows.md`。
- 想理解系统组成：读 `architecture.md`。
- 任务卡住、重启或怕重复扣费：读 `database-and-tasks.md` 和 `troubleshooting.md`。
- 想找接口：读 `api-and-integration.md` 与 `generated/route-index.md`。
- 想维护/升级/备份：读 `operations.md`。
- 想了解模型和供应商：读 `providers-and-models.md`。
- Codex 接手项目：先读 `AI_ASSISTANT_CONTEXT.md`。

`knowledge-map.yaml` 是机器可读的关系源文件；它采用 JSON 语法（同时是合法 YAML），用 `yarn knowledge:check` 校验，用 `yarn knowledge:build` 生成索引。
