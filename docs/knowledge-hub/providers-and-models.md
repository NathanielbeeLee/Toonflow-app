# 供应商与模型

Toonflow 的供应商代码位于 `data/vendor/*.ts`，用户可配置供应商输入和模型列表。业务以 `供应商ID:模型名` 标识模型。视频模式覆盖文本、单图首帧、首尾帧和多参考图/音频/视频。

可恢复视频 adapter 的可选契约是 `videoSubmit → videoPoll → videoCancel`，旧 `videoRequest` 保持兼容。普通 `volcengine`、OpenAI 标准供应商、MiniMax 和可灵已拆出提交和轮询：提交后保存远端任务身份，重启后继续轮询。`videoCancel` 只有供应商真实支持远端取消时才实现，不能猜测接口。

OpenAI 标准供应商 2.2 支持 GPT Image 1.5/2，以及官方 Videos API 的 `POST /videos → GET /videos/{id} → GET /videos/{id}/content`。官方契约见 [OpenAI 视频生成文档](https://developers.openai.com/api/docs/guides/video-generation)。CLIProxyAPI 使用 `http://localhost:8317/v1` 时会自动把视频请求切到 `/openai/v1`，也可单独配置视频地址。

CLIProxyAPI 7.2.120 的 `/openai/v1/videos` 会把 `sora-2` 兼容请求路由到 xAI 视频执行器；模型列表不代表路由不存在，但没有 xAI/Sora 凭据时无法真实生成。当前本机只读探测未发现视频模型，因此只完成协议与本地 Mock 验证，未进行付费生成。

MiniMax 2.2 使用 `/v1/video_generation` 创建任务、`/v1/query/video_generation` 查询状态，并在成功后按 `file_id` 获取下载地址。远端 task ID 可恢复；当前未实现未经确认的远端取消。

可灵 2.1 覆盖 `text2video`、`image2video`、`multi-image2video` 和 `omni-video`。持久身份以受控路径加 task ID 组成，恢复时只允许这四个路径，避免任务数据被用于任意请求；当前没有实现未经确认的远端取消。

当前限制：`volcengineSd2` 等其他 vendor 仍在一次调用中完成；它们尚不能自动恢复远端轮询。OpenAI 图片适配当前只开放文生图，参考图编辑需后续实现 multipart `/images/edits`。后续还需补齐参数预检、费用估算、取消和统一结果规范。
