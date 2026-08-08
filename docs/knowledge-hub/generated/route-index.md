# 接口索引（自动生成）

| 接口 | 功能 | 节点 |
| --- | --- | --- |
| POST /api/production/workbench/generateVideo | 持久视频任务 | feature.durable-video-tasks |
| POST /api/production/workbench/batchGenerateVideo | 持久视频任务 | feature.durable-video-tasks |
| POST /api/generationTasks/list | 持久视频任务 | feature.durable-video-tasks |
| POST /api/assetsGenerate/generateAssets | 持久图片任务 | feature.durable-image-tasks |
| POST /api/production/editImage/generateFlowImage | 持久图片任务 | feature.durable-image-tasks |
| POST /api/script/extractAssets | 持久剧本资产提取 | feature.durable-script-asset-extraction |
| POST /api/generationTasks/list | 持久剧本资产提取 | feature.durable-script-asset-extraction |
| POST /api/script/importNovel/preview | AI Novel 成品版本化导入 | feature.ai-novel-import |
| POST /api/script/importNovel/commit | AI Novel 成品版本化导入 | feature.ai-novel-import |
| POST /api/generationTasks/limits/list | 供应商与模型限流 | feature.provider-limits |
| POST /api/generationTasks/limits/upsert | 供应商与模型限流 | feature.provider-limits |
| POST /api/voiceStudio/casts/list | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| POST /api/voiceStudio/utterances/import | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| POST /api/voiceStudio/utterances/generate | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| POST /api/voiceStudio/cues/export | 角色音色、逐句台词与字幕 cue | feature.voice-utterance-studio |
| POST /api/voiceStudio/casts/upsert | 配音与字幕 API | api.voice-studio |
| POST /api/voiceStudio/utterances/batchGenerate | 配音与字幕 API | api.voice-studio |
| POST /api/voiceStudio/cues/rebuild | 配音与字幕 API | api.voice-studio |
| POST /api/voiceStudio/cues/export | 配音与字幕 API | api.voice-studio |
| POST /api/composition/timeline/build | 规范化多轨时间线 | feature.normalized-timeline |
| POST /api/composition/timeline/latest | 规范化多轨时间线 | feature.normalized-timeline |
| POST /api/composition/timeline/list | 规范化多轨时间线 | feature.normalized-timeline |
| POST /api/composition/timeline/render | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| POST /api/composition/timeline/jobs/latest | 持久 FFmpeg 低清预览 | feature.ffmpeg-preview-render |
| POST /api/composition/timeline/qa/run | 持久成片媒体 QA | feature.media-qa |
| POST /api/composition/timeline/qa/latest | 持久成片媒体 QA | feature.media-qa |
| POST /api/generationTasks/limits/budget/get | 项目预算与成片审核 | feature.budget-review-gates |
| POST /api/generationTasks/limits/pricing/upsert | 项目预算与成片审核 | feature.budget-review-gates |
| POST /api/composition/timeline/review/record | 项目预算与成片审核 | feature.budget-review-gates |
| POST /api/composition/timeline/publish/create | 审核门禁发布交付包 | feature.publish-package |
| POST /api/composition/timeline/publish/latest | 审核门禁发布交付包 | feature.publish-package |
| POST /api/login/login | 本地认证与脱敏诊断 | feature.local-security-diagnostics |
| POST /api/setting/diagnostics/export | 本地认证与脱敏诊断 | feature.local-security-diagnostics |
| POST /api/generationTasks/list | 持久任务中心 | feature.durable-task-center |
| POST /api/generationTasks/cancel | 持久任务中心 | feature.durable-task-center |
| POST /api/generationTasks/retry | 持久任务中心 | feature.durable-task-center |
| POST /api/generationTasks/limits/list | 持久任务中心 | feature.durable-task-center |
| POST /api/generationTasks/limits/upsert | 持久任务中心 | feature.durable-task-center |
| POST /api/generationTasks/get | 持久任务 API | api.generation-tasks |
| POST /api/generationTasks/list | 持久任务 API | api.generation-tasks |
| POST /api/generationTasks/cancel | 持久任务 API | api.generation-tasks |
| POST /api/generationTasks/retry | 持久任务 API | api.generation-tasks |
