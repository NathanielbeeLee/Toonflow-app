# 功能索引（自动生成）

| 功能 | 说明 | 节点 |
| --- | --- | --- |
| 小说到动态镜头 | 从原文、剧本、资产和分镜进入视频生成与人工选片 | workflow.novel-to-video |
| 双 Agent 与导演 Skill | 剧本理解和生产导演分层协作，并以题材 Skill 固化镜头知识 | feature.agent-directing |
| 资产与分镜一致性 | 角色、场景、道具资产复用并作为分镜和视频模型参考输入；角色/道具近名按类型唯一命中时复用 | feature.asset-consistency |
| 无限画布生产工作台 | 以可缩放、可平移、可拖动节点的空间界面串联剧本、导演计划、资产、分镜和视频工作台 | feature.infinite-canvas |
| 持久视频任务 | 单条/批量视频生成持久化、有限并发、去重、取消，并对支持的供应商恢复远端轮询 | feature.durable-video-tasks |
| 持久图片任务 | 批量/单张资产图、分镜图和图片画布节点逐项持久化、去重、限流，并按付费边界恢复 | feature.durable-image-tasks |
| 视频生成准备度门禁 | 在预算预留和供应商提交前检查提示词、参考素材、模型模式、时长分辨率、供应商配置与活动任务 | feature.video-readiness-gate |
| 分镜动作拍点与人工确认 | Agent 生成有序动作候选，用户编辑确认后才把阶段约束编译进视频提示词，旧分镜保持兼容 | feature.storyboard-action-beats |
| 视频海报帧与轻量列表 | 视频保存后异步生成本地 JPEG 海报，历史视频按需回填，列表优先加载图片且失败不影响视频成功 | feature.video-poster-frames |
| 持久剧本资产提取 | 按当前项目和所选剧本持久执行资产提取，限制模型关联 ID，并按付费边界安全恢复 | feature.durable-script-asset-extraction |
| AI Novel 成品版本化导入 | 从小说章节或成品短剧 JSON 预览、选择并按外部 ID 幂等导入 Toonflow 剧本 | feature.ai-novel-import |
| 供应商与模型限流 | 按供应商、模型和任务通道执行最大并发、RPM 与冷却时间规则 | feature.provider-limits |
| 角色音色、逐句台词与字幕 cue | 把剧本确定性拆成可编辑、可锁定、可单句生成的台词，并保存独立字幕时间片 | feature.voice-utterance-studio |
| 规范化多轨时间线 | 把选片、原生音频、逐句配音和字幕确定性构建成渲染器无关、可版本化的多轨时间线 | feature.normalized-timeline |
| 持久 FFmpeg 低清预览 | 把固定时间线版本渲染为低清或高清 H.264/AAC，含六轨混音、对白 ducking、两遍响度和字幕烧录 | feature.ffmpeg-preview-render |
| 持久成片媒体 QA | 对成片执行技术、黑帧、冻结帧、静音、响度、字幕安全区和流程检查，并保存可定位报告 | feature.media-qa |
| 项目预算与成片审核 | 按用户价格规则在生成前预留预算、阻止超额，并把人工审核绑定成片输出校验和 | feature.budget-review-gates |
| 审核门禁发布交付包 | 把通过同一输出 QA 与审核关卡的高清成片持久打包为含字幕、证据、manifest 和校验和的 ZIP | feature.publish-package |
| 本地认证与脱敏诊断 | scrypt 密码、默认密码首次改密、本机监听边界和不含秘密/业务内容的诊断导出 | feature.local-security-diagnostics |
| 持久任务中心 | 自动刷新并展示持久任务状态、远端 job ID、重试次数和安全人工介入操作 | feature.durable-task-center |
| 供应商远端任务恢复 | 保存视频供应商 job ID，重启或轮询失败后继续查询原任务 | feature.provider-job-resume |
