# 数据索引（自动生成）

| 表 | 功能 | 节点 |
| --- | --- | --- |
| o_assets | 资产与分镜一致性 | feature.asset-consistency |
| o_storyboard | 资产与分镜一致性 | feature.asset-consistency |
| generation_tasks | 持久视频任务 | feature.durable-video-tasks |
| task_dependencies | 持久视频任务 | feature.durable-video-tasks |
| project_events | 持久视频任务 | feature.durable-video-tasks |
| generation_tasks | 持久图片任务 | feature.durable-image-tasks |
| provider_limits | 持久图片任务 | feature.durable-image-tasks |
| o_image | 持久图片任务 | feature.durable-image-tasks |
| o_storyboard | 持久图片任务 | feature.durable-image-tasks |
| o_imageFlow | 持久图片任务 | feature.durable-image-tasks |
| provider_limits | 供应商与模型限流 | feature.provider-limits |
| voice_cast | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| utterances | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| subtitle_cues | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| generation_tasks | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| project_timelines | 规范化多轨时间线 | feature.normalized-timeline |
| composition_jobs | 规范化多轨时间线 | feature.normalized-timeline |
| utterances | 规范化多轨时间线 | feature.normalized-timeline |
| subtitle_cues | 规范化多轨时间线 | feature.normalized-timeline |
| o_video | 规范化多轨时间线 | feature.normalized-timeline |
| o_videoTrack | 规范化多轨时间线 | feature.normalized-timeline |
| project_timelines | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| project_audio_clips | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| composition_jobs | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| generation_tasks | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| media_qa_reports | 持久成片媒体 QA | feature.media-qa |
| composition_jobs | 持久成片媒体 QA | feature.media-qa |
| generation_tasks | 持久成片媒体 QA | feature.media-qa |
| project_budget_controls | 项目预算与成片审核 | feature.budget-review-gates |
| pricing_rules | 项目预算与成片审核 | feature.budget-review-gates |
| usage_ledger | 项目预算与成片审核 | feature.budget-review-gates |
| composition_reviews | 项目预算与成片审核 | feature.budget-review-gates |
| o_user | 本地认证与脱敏诊断 | feature.local-security-diagnostics |
| schema_migrations | 本地认证与脱敏诊断 | feature.local-security-diagnostics |
| generation_tasks | 本地认证与脱敏诊断 | feature.local-security-diagnostics |
| generation_tasks | 持久任务中心 | feature.durable-task-center |
| generation_tasks | generation_tasks | table.generation-tasks |
| generation_tasks | 供应商远端任务恢复 | feature.provider-job-resume |
