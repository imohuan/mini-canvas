# Canvas Refactor Plan Review Summary

> 2026-06-18 复查新增。后续执行时，请先读本文件，再按 `01` → `02` → `03` → `04` 顺序做。

## CodeGraph 复查结论

我用 CodeGraph 看了当前代码结构，重点核对了：

- `src/canvas/core/Canvas.vue`
- `src/canvas/core/plugins/PluginManager.ts`
- `src/canvas/core/plugins/PluginContext.ts`
- `src/canvas/core/plugins/types.ts`
- `src/canvas/core/plugins/storage/StoragePlugin.ts`
- `src/canvas/core/components/CustomNode.vue`
- `src/canvas/core/plugins/auto-save/AutoSavePlugin.ts`
- `src/canvas/core/components/nodes/image/ImageTopToolbar.vue`
- `src/canvas/core/plugins/file-drop/FileDropPlugin.ts`

CodeGraph 当前索引：92 个文件，963 个代码节点，2031 条关系。

## 原计划主要缺口

1. `CanvasRuntimeProvider` 和 `useCanvasRuntime()` 各自创建 `Symbol('canvasRuntime')`，会导致 inject 拿不到 runtime。
2. `context.getPlugin('storage')` 只返回插件定义对象，不返回 install 后的 API；插件间调用必须新增 `context.getPluginAPI<T>(name)`。
3. `NodeRegistry` 没真正接进 `PluginContext`。节点插件只调用 `registerNodeType()` 不够，拿不到 toolbar、默认尺寸、菜单信息。
4. `StoragePlugin.sanitizeForSave()` 会把 VueFlow 的 `type: 'custom'` 改成不存在的 `image-input`，这是 P0 级保存损坏问题。
5. `Canvas.vue` 和 `AutoSavePlugin + StoragePlugin` 同时保存画布，存在两套保存链路。最终只能保留 `VueFlow state -> AutoSavePlugin -> StoragePlugin.saveCanvas()`。
6. `MenuRegistry.getInstance()`、`ShortcutManager.getInstance()` 会继续制造全局单例问题。菜单注册表必须跟随当前 Canvas runtime；快捷键单例迁移放到第 4 阶段。
7. 原计划遗漏了：类型化事件、统一节点数据模型、插件 UI 注册、DOM 交互服务、StoragePlugin 拆分、PluginManager 拆分。

## 执行硬规则

- VueFlow 渲染类型继续是 `node.type === 'custom'`。
- 业务节点类型只放在 `node.data.nodeType`。
- 组件里拿插件 API：`usePluginApi<T>('storage')`。
- 插件里拿插件 API：`context.getPluginAPI<T>('storage')`。
- 不要再新增全局单例；注册表挂到当前 `CanvasRuntime` 或 `PluginContext`。
- `canvas-data` 这条旧本地保存链路要删除，不要抽成新的 composable 保留下来。

## 计划文件说明

- `01-canvas-runtime-node-registry.md`：先打通 runtime、插件 API、NodeRegistry、节点插件化。
- `02-plugin-system-menu-handle-find-storage.md`：再做菜单、端口、搜索、Storage 保存修复。
- `03-performance-cleanup-composables.md`：删除重复保存，拆 Canvas/Pannel，修性能和泄漏。
- `04-architecture-hardening.md`：补更底层的架构边界：Storage 拆分、PluginManager 拆分、插件 UI、DOM 服务、快捷键实例化。
