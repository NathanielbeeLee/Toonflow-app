# OpenMontage 规范化时间线吸收决策

- 来源：OpenMontage
- 来源扫描修订：`4eab34c5cfcccaa4f1970554928feccce73ee930`
- 许可证：AGPL-3.0，只允许参考公开架构与行为，禁止复制源码。
- Toonflow 落地提交：`07c229d9`

## 采纳

- 渲染器无关、可版本化、带输入校验和的规范化时间线。
- 视频、视频原生音频、对白、旁白、SFX、环境声、BGM 和字幕分轨。
- 为画幅、帧率、色彩、采样率、响度和 true peak 提供统一 preset 输入。
- 在渲染前产生缺失选片、字幕/配音超时等结构化警告。

## 独立实现差异

- 使用 Toonflow 现有 TypeScript、SQLite、Vue 和本地 OSS，不引入 OpenMontage Python 运行时。
- timeline 从 Toonflow 的选片、逐句音频和字幕 cue 确定性构建，输入未变化时不产生重复版本。
- 本批不执行渲染；FFmpeg 命令构造、ducking、响度和 QA 在后续小批次实现。

## 后续增量扫描

OpenMontage 后续从 `4eab34c5cfcccaa4f1970554928feccce73ee930` 之后扫描；重点比较 timeline schema、多轨混音、响度与媒体 QA 行为变化，继续禁止复制 AGPL 源码。
