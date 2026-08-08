# 架构

```mermaid
flowchart LR
  UI["data/web 前端 / Electron"] --> API["Express 路由"]
  API --> Domain["项目、剧本、资产、分镜"]
  Domain --> Agent["剧本 Agent / 生产 Agent / 导演 Skills"]
  API --> Queue["SQLite 持久任务引擎"]
  Queue --> Vendor["可编辑 Vendor 模板"]
  Vendor --> Cloud["文本/图片/视频/TTS 供应商"]
  Queue --> Media["本地 OSS 媒体目录"]
  Queue --> Events["任务与项目事件"]
  Knowledge["知识地图"] -.说明.-> API
  Knowledge -.定位.-> Queue
```

当前运行时是单个 TypeScript/Express/Electron 应用，数据库为本地 SQLite。外部参考项目不参与运行。`data/web` 仍是发布产物；可维护 Toonflow-web 源码已在统一外部目录登记，但尚未 subtree 导入 `frontend/`。
