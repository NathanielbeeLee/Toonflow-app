# 数据库与任务

`generation_tasks` 是新任务事实源，`o_tasks`/`o_video` 仍同步状态供旧页面读取。关键字段：

- `payload`：版本化任务输入，只保存本地业务数据和模型名，不应保存 API Key。
- `resource_key`：同一轨道活动任务占用，防止重复点击。
- `idempotency_key`：客户端 requestId 与资源组合的稳定哈希。
- `lease_owner/lease_expires_at`：worker 所有权与崩溃接管边界。
- `attempts/max_attempts/next_run_at`：有限退避重试。
- `provider_job_id`：供应商提交后立即保存的远端任务身份。普通火山引擎、OpenAI 标准接口、MiniMax 和可灵已支持；可灵身份包含受控查询路径与 task ID。
- `provider_limits`：供应商/模型/通道级最大并发、RPM 和冷却时间；任务中心可维护，未配置时默认并发 2、RPM 10。

状态主线：`queued → claimed → submitting → submitted → polling → finalizing → succeeded`。有远端任务编号时，轮询失败、保存失败或应用重启会重新排队并恢复同一任务；没有编号的付费边界不确定错误进入 `manual_review`。取消使用 `cancelling/cancelled`。

用户可从左侧“任务中心 → 持久任务”查看这些字段的安全摘要，按项目、通道和状态筛选，并执行取消或重试。单条/批量视频、批量资产图和批量分镜图使用该事实源；原 `o_tasks` 记录位于“历史任务”页签。

## 配音与字幕数据

- `voice_cast`：项目的角色音色表，保存角色资产、供应商/模型/音色、语速、音高、音量、情绪和试听资产引用。
- `utterances`：剧本或分镜中的最小可恢复配音单元，保存说话人、文本、角色/音色绑定、缓存身份、音频路径、时长、状态和人工锁定。
- `subtitle_cues`：独立字幕时间片，保存开始/结束毫秒、文本、样式和人工锁定；重建只替换未锁定 cue。

`tts.utterance.generate` 使用 `audio` 通道。缓存身份由文本、供应商模型、音色和发音参数决定；参数未变化且已有成功音频时直接复用。同步式 TTS 无法保存远端 job ID，因此越过供应商调用边界后的不确定失败进入 `manual_review`，不会自动重复扣费。

## 时间线与合成

- `project_timelines`：按项目/剧本保存 renderer-neutral timeline JSON、递增版本、状态和 SHA-256 输入校验和；输入未变化时复用最新版本。
- `composition_jobs`：保存时间线版本、renderer、preset、输入/输出校验和、输出路径、媒体时长、结构化渲染日志、持久任务和错误归属。
- `project_audio_clips`：保存剧本级 SFX、环境声和 BGM 片段，引用现有声音资产并记录开始/入点/时长/增益/淡入淡出。

timeline schema v1 包含画幅、fps、BT.709、48kHz、响度/true peak 目标，以及视频、原生音频、对白、旁白、SFX、环境声、BGM 和字幕轨。

`composition.render` 使用 `compose` 通道，由本地 FFmpeg worker 执行。任务固定绑定 timeline ID、版本和校验和；输入变化必须产生新时间线版本，不能在后台悄悄替换。渲染先写 `.partial` 临时文件，成功后原子移动到本地 OSS，并计算 SHA-256；失败或取消会清理半成品。本地任务在 lease 过期后可安全重新排队，不进入付费供应商的人工确认态。

`preview-low` 和 `final-high` 支持视频裁剪/串联、横竖屏统一、H.264/AAC 和 faststart。六类声音按 `startMs` 对齐并统一为 48kHz 立体声；dialogue sidechain 压低背景总线，24-bit PCM 中间母带再执行 loudnorm 两遍标准化。字幕由 Sharp 生成透明图层后使用 FFmpeg overlay 按 cue 烧录，不要求 FFmpeg 编译 drawtext/libass。探测不到音轨或文件缺失时记录到结构化日志并跳过。媒体工具只通过参数数组启动，不拼接任意 shell 命令；可用 `FFPROBE_PATH`、`FFMPEG_PATH` 指定可执行文件。
