# 功能索引（自动生成）

| 功能 | 说明 | 节点 |
| --- | --- | --- |
| 小说到动态镜头 | 从原文、剧本、资产和分镜进入视频生成与人工选片 | workflow.novel-to-video |
| 双 Agent 与导演 Skill | 剧本理解和生产导演分层协作，并以题材 Skill 固化镜头知识 | feature.agent-directing |
| 资产与分镜一致性 | 角色、场景、道具资产复用并作为分镜和视频模型参考输入 | feature.asset-consistency |
| 无限画布生产工作台 | 以可缩放、可平移、可拖动节点的空间界面串联剧本、导演计划、资产、分镜和视频工作台 | feature.infinite-canvas |
| 持久视频任务 | 单条/批量视频生成持久化、有限并发、去重、取消，并对支持的供应商恢复远端轮询 | feature.durable-video-tasks |
| 供应商远端任务恢复 | 保存视频供应商 job ID，重启或轮询失败后继续查询原任务 | feature.provider-job-resume |
