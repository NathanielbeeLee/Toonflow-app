# 供应商与模型

Toonflow 的供应商代码位于 `data/vendor/*.ts`，用户可配置供应商输入和模型列表。业务以 `供应商ID:模型名` 标识模型。视频模式覆盖文本、单图首帧、首尾帧和多参考图/音频/视频。

当前限制：每个 vendor 的 `videoRequest` 多数在一个函数内部完成提交、轮询和结果下载。持久任务只能保护调用外围，不能统一持久化远端 job ID。下一阶段需要稳定 adapter：`validate → estimate → submit → poll/resume → cancel → normalizeResult`，并让模型能力、时长、分辨率、参考数量和音频支持成为单一真相源。
