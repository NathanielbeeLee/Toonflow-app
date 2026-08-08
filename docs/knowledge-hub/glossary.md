# 术语

- 资产：角色、场景、道具及其图片/音频版本。
- 分镜：一个镜头的画面、动作、运镜、时长、台词和关联资产描述。
- lane：任务资源类别，如 video、audio、compose。
- lease：worker 对任务的限时所有权，心跳续期，过期后按付费边界恢复。
- 幂等：相同 requestId 的重复请求返回已有任务，不重复提交。
- `manual_review`：供应商远端状态未知，必须人工核对后再决定。
- 代码上游：可审查后 merge/subtree 的 Toonflow-app / Toonflow-web。
- 参考上游：只扫描并选择性重写能力的外部项目。
