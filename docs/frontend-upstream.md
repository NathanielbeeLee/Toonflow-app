# Toonflow-web 前端上游

## 首次纳入

- 上游：`https://github.com/HBAI-Ltd/Toonflow-web.git`
- 默认分支：`master`
- 首次修订：`9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214`
- 本地目录：`frontend/`
- 方式：git subtree（squash），首次导入日期 2026-08-08。

首次命令等价于：

```bash
git remote add toonflow-web https://github.com/HBAI-Ltd/Toonflow-web.git
git subtree add --prefix=frontend toonflow-web master --squash
```

由于导入时主工作区保留用户未提交的计划文档修改，实际在干净临时 worktree 生成 subtree merge，再以第一父节点主线带回 `toon-custom`；导入内容与标准 subtree 完全一致。

## 开发与构建

```bash
yarn frontend:install
yarn frontend:dev
yarn frontend:build
yarn frontend:sync
```

只修改 `frontend/` 源码，不手工编辑 `data/web`。`frontend:sync` 只接受已经成功生成 `frontend/dist/index.html` 的构建结果，并通过临时目录交换产物，失败时恢复旧 `data/web`。

根命令 `yarn build` 会先构建并同步前端，再构建后端/Electron。

首次导入后的本地兼容处理：构建先运行 Vite 生成自动导入声明，再执行 `vue-tsc`；Node 配置禁止输出编译副产物；Markdown 编辑器在“跟随系统”主题下不再把 `auto` 直接传给只接受明/暗主题的组件。两个未被引用的 `copy.vue` 备份文件因语法/类型错误删除，正式页面不受影响。

## 后续同步

工作区干净并完成数据备份后：

```bash
git fetch toonflow-web master
git subtree pull --prefix=frontend toonflow-web master --squash
yarn frontend:install
yarn frontend:build
yarn frontend:sync
```

每次记录旧/新上游 commit、冲突、接口变化和构建结果。同步后必须同时检查 `frontend/` 与 `data/web`，不能只更新源码。
