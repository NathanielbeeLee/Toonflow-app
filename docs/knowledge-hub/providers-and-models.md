# 供应商与模型

Toonflow 的供应商代码位于 `data/vendor/*.ts`，用户可配置供应商输入和模型列表。业务以 `供应商ID:模型名` 标识模型。视频模式覆盖文本、单图首帧、首尾帧和多参考图/音频/视频。

可恢复视频 adapter 的可选契约是 `videoSubmit → videoPoll → videoCancel`，旧 `videoRequest` 保持兼容。普通 `volcengine` 已拆出提交和轮询：提交后保存 job ID，重启后继续轮询。`videoCancel` 只有供应商真实支持远端取消时才实现，不能猜测接口。

当前限制：`volcengineSd2` 的多参考素材上传和其他 vendor 仍在一次调用中完成；它们尚不能自动恢复远端轮询。后续还需补齐参数预检、费用估算、取消和统一结果规范，并让时长、分辨率、参考数量与音频能力成为单一真相源。
