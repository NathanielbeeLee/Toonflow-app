# 关系图（自动生成）

| 来源 | 关系 | 目标 |
| --- | --- | --- |
| workflow.novel-to-video | uses | feature.agent-directing |
| workflow.novel-to-video | uses | feature.asset-consistency |
| workflow.novel-to-video | uses | feature.durable-video-tasks |
| feature.agent-directing | documented_by | document.feature-catalog |
| feature.asset-consistency | documented_by | document.feature-catalog |
| feature.durable-video-tasks | writes | table.generation-tasks |
| feature.durable-video-tasks | exposed_by | api.generation-tasks |
| feature.durable-video-tasks | uses | concept.worker-lease |
| feature.durable-video-tasks | uses | feature.provider-job-resume |
| feature.durable-video-tasks | troubleshoots | troubleshooting.unknown-provider-state |
| api.generation-tasks | reads | table.generation-tasks |
| table.generation-tasks | documented_by | document.database-tasks |
| concept.worker-lease | writes | table.generation-tasks |
| feature.provider-job-resume | writes | table.generation-tasks |
| feature.provider-job-resume | uses | provider.volcengine |
| feature.provider-job-resume | depends_on | concept.worker-lease |
| provider.volcengine | documented_by | document.database-tasks |
| troubleshooting.unknown-provider-state | documented_by | document.troubleshooting |
| document.upstream-watch | documented_by | document.feature-catalog |
