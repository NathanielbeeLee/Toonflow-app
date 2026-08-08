# 参考能力矩阵

| 来源（扫描修订） | 能力与证据路径 | 价值 | 限制/许可 | 本轮决定与 Toonflow 落点 |
| --- | --- | --- | --- | --- |
| ArcReel `d544f613` | `lib/generation_queue.py`、`lib/db/repositories/task_repo.py`、`lib/generation_worker.py` | 持久任务、占用去重、取消、恢复、供应商身份锁定 | AGPL-3.0；不能直接复制到 Apache 项目 | 采用设计并以 TypeScript/Knex 重写到 `src/services/task-engine/` |
| ArcReel `d544f613` | `server/services/cost_estimation.py`、`lib/usage_tracker.py` | 预估/实付费用与模型归属 | 需先有稳定 provider adapter 和价格快照 | 建表预留，代码列入下一批 |
| OpenMontage `4eab34c5` | `tools/audio/audio_mixer.py`、`tools/subtitle/subtitle_gen.py`、`schemas/artifacts/action_timeline.schema.json` | 多轨混音、ducking、字幕、规范化时间线 | AGPL-3.0；Python 工具不能成为运行时依赖 | 高价值 backlog，后续按 TypeScript/FFmpeg 重写 |
| OpenMontage `4eab34c5` | `tools/analysis/`、render review schemas | 黑帧/静音/响度等 QA | 需要本地媒体 fixture 与 FFmpeg | 高价值 backlog |
| huobao-drama `eb117853` | `backend/src/services/tts-generation.ts`、`skills/voice_assigner/` | 角色音色与 TTS 操作入口 | 仓库无 LICENSE，禁止复制源码 | 已独立实现角色音色、逐句台词、字幕 cue 和持久任务底座；不复制源码，真实供应商与页面继续实施 |
| huobao-drama `eb117853` | `backend/src/services/ffmpeg-compose.ts` | 单镜头/整集合成 | 简单 concat/替换音轨质量不足 | 拒绝照搬，实现时以 OpenMontage 多轨方案为准 |
| MoneyPrinterTurbo `e14dea55` | `app/services/subtitle.py`、`voice.py`、`video.py` | 字幕样式、BGM、发布包装 | MIT；主链偏素材混剪 | 包装能力列 P1，素材检索只允许显式兜底 |

本轮没有复制任何 AGPL 或无许可证仓库的源码；只依据公开架构和行为重新设计。
