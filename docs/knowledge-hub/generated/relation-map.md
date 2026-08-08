# 关系图（自动生成）

| 来源 | 关系 | 目标 |
| --- | --- | --- |
| workflow.novel-to-video | uses | feature.agent-directing |
| workflow.novel-to-video | uses | feature.asset-consistency |
| workflow.novel-to-video | uses | feature.durable-video-batch |
| feature.agent-directing | documented_by | document.feature-catalog |
| feature.asset-consistency | documented_by | document.feature-catalog |
| feature.durable-video-batch | writes | table.generation-tasks |
| feature.durable-video-batch | exposed_by | api.generation-tasks |
| feature.durable-video-batch | uses | concept.worker-lease |
| feature.durable-video-batch | troubleshoots | troubleshooting.unknown-provider-state |
| api.generation-tasks | reads | table.generation-tasks |
| table.generation-tasks | documented_by | document.database-tasks |
| concept.worker-lease | writes | table.generation-tasks |
| troubleshooting.unknown-provider-state | documented_by | document.troubleshooting |
| document.upstream-watch | documented_by | document.feature-catalog |
