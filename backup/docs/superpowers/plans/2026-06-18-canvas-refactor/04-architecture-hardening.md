# Plan 4: 架构补强 — Storage 拆分 + PluginManager 拆分 + 插件 UI/DOM/快捷键边界

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补上前 3 份计划没完全覆盖的底层架构问题：StoragePlugin 过胖、PluginManager 过胖、插件 UI 注册不统一、插件直接摸 DOM、ShortcutManager 全局单例。

**Architecture:** 这一阶段不改用户可见功能，主要改边界。Storage 变成 Repository + AssetRuntimeService；PluginManager 变成门面；插件 UI 通过 Registry 注册；DOM 监听通过 context 服务统一清理；快捷键管理跟随 CanvasRuntime。

**Tech Stack:** Vue 3 + TypeScript, VueFlow, Pinia, Node native `node:test`, pnpm。

---

## 为什么新增这份计划

`history.md` 里提到的这些问题，原 3 份计划没有完整覆盖：

- `StoragePlugin.ts` 同时管项目、文件系统、localStorage、资产 URL、保存/加载。
- `PluginManager.ts` 同时管依赖排序、安装、回滚、生命周期、注册表、上下文创建。
- 插件 UI 有 overlay、toolbar、panel、dialog，但挂载方式不统一。
- 很多插件直接 `document.querySelector` / `window.addEventListener`，卸载清理容易漏。
- `ShortcutManager.getInstance()` 是全局单例，多画布会互相污染。

---

### Task 1: 拆 StoragePlugin 为仓库和资产运行时服务

**Files:**
- Create: `src/canvas/core/storage/ProjectRepository.ts`
- Create: `src/canvas/core/storage/CanvasRepository.ts`
- Create: `src/canvas/core/storage/AssetRuntimeService.ts`
- Create: `src/canvas/core/storage/LocalStorageProjectStore.ts`
- Create: `src/canvas/core/storage/FileSystemProjectStore.ts`
- Modify: `src/canvas/core/plugins/storage/StoragePlugin.ts`

- [ ] **Step 1: ProjectRepository 负责项目列表**

Create interface:

```typescript
export interface ProjectRepository {
  listProjects(): ProjectMeta[]
  createProject(name: string): ProjectMeta
  deleteProject(id: string): Promise<void>
  getCurrentProjectId(): string | null
  setCurrentProjectId(id: string | null): void
  loadIndex(): Promise<void>
  saveIndex(): Promise<void>
}
```

Move these out of `StoragePlugin.ts`:

- `projectIndex`
- `currentProjectId`
- `loadProjectsFromLocalStorage`
- `saveProjectsToLocalStorage`
- filesystem index read/write

- [ ] **Step 2: CanvasRepository 负责画布数据保存加载**

Create interface:

```typescript
export interface CanvasRepository {
  saveCanvas(projectId: string, nodes: unknown[], edges: unknown[]): Promise<void>
  loadCanvas(projectId: string): Promise<CanvasData>
  clearCache(projectId?: string): void
}
```

Move:

- `canvasDataCache`
- `saveCanvasToLocalStorage`
- `loadCanvasFromLocalStorage`
- filesystem `project.json` read/write
- `sanitizeForSave()` usage

- [ ] **Step 3: AssetRuntimeService 负责 URL 生命周期**

Create `AssetRuntimeService.ts`:

```typescript
export class AssetRuntimeService {
  constructor(private readonly assetManager: AssetManager) {}

  async restoreNodeAssetUrls(nodes: any[]): Promise<any[]> {
    const restored: any[] = []
    for (const node of nodes) {
      const data = node.data as any
      if (!data?.assetId) {
        restored.push(node)
        continue
      }
      const url = await this.assetManager.getObjectURL(data.assetId)
      if (!url) {
        restored.push(node)
        continue
      }
      const key = data.nodeType === 'video' ? 'videoUrl' : 'imageUrl'
      restored.push({ ...node, data: { ...data, [key]: url } })
    }
    return restored
  }

  releaseProjectUrls(): void {
    this.assetManager.revokeAllURLs()
  }
}
```

- [ ] **Step 4: StoragePlugin 只组装 API**

After moving logic, `StoragePlugin.ts` should mainly:

- create repositories/services
- expose `StorageAPI`
- emit storage events
- cleanup on uninstall

Target file length: under ~250 lines.

- [ ] **Step 5: 构建 + 测试 + 提交**

```powershell
node --test src\canvas\core\plugins\storage\__tests__\*.test.ts
pnpm build
git add src/canvas/core/storage src/canvas/core/plugins/storage/StoragePlugin.ts
git commit -m "refactor: split storage plugin into repositories and asset runtime service"
```

---

### Task 2: 拆 PluginManager 为门面 + 安装器 + 注册表 + 依赖图

**Files:**
- Create: `src/canvas/core/plugins/PluginRegistry.ts`
- Create: `src/canvas/core/plugins/PluginDependencyGraph.ts`
- Create: `src/canvas/core/plugins/PluginInstaller.ts`
- Create: `src/canvas/core/plugins/PluginLifecycleStore.ts`
- Modify: `src/canvas/core/plugins/PluginManager.ts`

- [ ] **Step 1: PluginRegistry**

Move maps out of `PluginManager.ts`:

- `plugins`
- `contexts`
- `installResults`

Expose:

```typescript
registerPlugin(plugin: CanvasPlugin): void
setContext(name: string, context: PluginContext): void
setInstallResult(name: string, result: PluginInstallResult): void
getPlugin<T = CanvasPlugin>(name: string): T | null
getPluginAPI<T = unknown>(name: string): T | null
getContext(name: string): PluginContext | null
remove(name: string): void
```

- [ ] **Step 2: PluginDependencyGraph**

Move dependency sorting and cycle detection into `PluginDependencyGraph.ts`.

Expose:

```typescript
sort(plugins: CanvasPlugin[]): CanvasPlugin[]
```

- [ ] **Step 3: PluginInstaller**

Move install / uninstall / rollback logic into `PluginInstaller.ts`.

It receives registry, lifecycle store, eventBus, logger.

- [ ] **Step 4: PluginManager 变门面**

Keep public methods compatible:

- `install()`
- `uninstall()`
- `getPlugin()`
- `getPluginAPI()`
- `getContext()`
- `getLifecycle()`
- `getLoadOrder()`

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/plugins
git commit -m "refactor: split PluginManager internals into focused services"
```

---

### Task 3: 插件 UI 注册统一化

**Files:**
- Create: `src/canvas/core/registry/PanelRegistry.ts`
- Create: `src/canvas/core/registry/ToolbarRegistry.ts`
- Create: `src/canvas/core/registry/DialogRegistry.ts`
- Modify: `src/canvas/core/plugins/types.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: `src/canvas/core/Pannel.vue`

- [ ] **Step 1: 建 UI registry**

Each registry supports:

```typescript
register(source: string, definition: Definition): void
unregisterSource(source: string): void
getAll(): Definition[]
```

- [ ] **Step 2: PluginContext 添加 UI API**

Add:

```typescript
ui: {
  registerPanelSection(section: PanelSectionDefinition): void
  registerToolbar(toolbar: ToolbarDefinition): void
  registerDialog(dialog: DialogDefinition): void
}
```

- [ ] **Step 3: Pannel.vue 消费 PanelRegistry**

After built-in tabs, render plugin panel sections from `PanelRegistry.getAll()`.

- [ ] **Step 4: 迁移 Storage/Theme/Layout 面板为可注册 section**

Keep current UI but route through registry. This gives future plugins a path without editing `Pannel.vue`.

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/registry src/canvas/core/plugins src/canvas/core/Pannel.vue
git commit -m "feat: add plugin UI registries for panels toolbars and dialogs"
```

---

### Task 4: DOM/Window 监听统一托管

**Files:**
- Create: `src/canvas/core/runtime/CanvasDomService.ts`
- Modify: `src/canvas/core/plugins/types.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: DOM-heavy plugins

- [ ] **Step 1: CanvasDomService**

Create service:

```typescript
export class CanvasDomService {
  private cleanups: Array<() => void> = []

  getPane(): HTMLElement | null {
    return document.querySelector('.vue-flow')
  }

  getViewport(): HTMLElement | null {
    return document.querySelector('.vue-flow__viewport')
  }

  onDocument<K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions): () => void {
    document.addEventListener(type, handler as EventListener, options)
    const cleanup = () => document.removeEventListener(type, handler as EventListener, options)
    this.cleanups.push(cleanup)
    return cleanup
  }

  onWindow<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): () => void {
    window.addEventListener(type, handler as EventListener, options)
    const cleanup = () => window.removeEventListener(type, handler as EventListener, options)
    this.cleanups.push(cleanup)
    return cleanup
  }

  cleanup(): void {
    for (const fn of this.cleanups.splice(0)) fn()
  }
}
```

- [ ] **Step 2: PluginContext 暴露 dom**

Add:

```typescript
readonly dom: CanvasDomService
```

- [ ] **Step 3: 迁移插件**

Replace direct listeners in:

- `AlignGuidePlugin.ts`
- `FileDropPlugin.ts`
- `MultiSelectPlugin.ts`
- `GroupPlugin.ts`
- `SelectionFrame.vue` where applicable

Use `context.dom.onDocument()` / `context.dom.onWindow()` so uninstall automatically cleans.

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/runtime src/canvas/core/plugins
git commit -m "refactor: centralize canvas DOM access and listener cleanup"
```

---

### Task 5: ShortcutManager 从全局单例迁到 CanvasRuntime

**Files:**
- Modify: `src/canvas/core/plugins/ShortcutManager.ts`
- Modify: `src/canvas/core/runtime/CanvasRuntime.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: `src/canvas/core/plugins/shortcut-manager/*`
- Modify: `src/canvas/core/Canvas.vue`

- [ ] **Step 1: CanvasRuntime 持有 shortcutManager**

In `CanvasRuntime.ts`:

```typescript
import { ShortcutManager } from '../plugins/ShortcutManager'

readonly shortcutManager = new ShortcutManager()
```

This requires making `ShortcutManager` constructor public and no longer forcing `getInstance()`.

- [ ] **Step 2: PluginContext 使用 runtime shortcutManager**

`registerShortcut` and `unregisterShortcut` should use the manager passed in context options, not `ShortcutManager.getInstance()`.

- [ ] **Step 3: shortcut-manager 插件组件通过 PluginAPI 拿当前 manager**

`RemapDialog.vue` and `ShortcutHelpPanel.vue` should receive manager/API through props or plugin API, not global singleton.

- [ ] **Step 4: 删除新代码中的 getInstance 调用**

```powershell
Select-String -Path 'src\canvas\core\**\*.ts','src\canvas\core\**\*.vue' -Pattern 'ShortcutManager.getInstance' -SimpleMatch
```

Expected: only compatibility code remains, or no matches。

- [ ] **Step 5: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core
git commit -m "refactor: scope ShortcutManager to CanvasRuntime"
```

---

### Task 6: 事件类型化

**Files:**
- Create: `src/canvas/core/runtime/CanvasEvents.ts`
- Create: `src/canvas/core/runtime/TypedEventBus.ts`
- Modify: `src/canvas/core/plugins/PluginContext.ts`
- Modify: event emit/listen call sites gradually

- [ ] **Step 1: 定义事件 payload**

Create `CanvasEvents.ts`:

```typescript
import type { EdgeChange, NodeChange } from '@vue-flow/core'
import type { StorageStatus } from '../plugins/storage/StoragePlugin'

export interface CanvasEvents {
  nodesChange: NodeChange[]
  edgesChange: EdgeChange[]
  nodeDragStop: unknown
  connect: unknown
  'storage:status': StorageStatus
  'storage:connected': { workspaceName: string }
  'storage:disconnected': Record<string, never>
  'storage:project-created': unknown
  'storage:project-deleted': unknown
  'storage:project-switched': unknown
  'history:record': unknown
  'history:state-change': { isRestoring: boolean }
  'selection:change': { nodeIds: string[]; edgeIds: string[] }
  'selection:clear': Record<string, never>
  'canvas:setFlag': { key: string; value: unknown }
}
```

- [ ] **Step 2: TypedEventBus**

Create generic typed wrapper:

```typescript
export class TypedEventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: any) => void>>()

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler as any)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.handlers.get(event)?.delete(handler as any)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload)
  }

  clear(): void {
    this.handlers.clear()
  }
}
```

- [ ] **Step 3: 逐步迁移 PluginContext event API**

Keep string API compatible at first, then type known events. Do not big-bang all plugins if build risk is high.

- [ ] **Step 4: 构建 + 提交**

```powershell
pnpm build
git add src/canvas/core/runtime src/canvas/core/plugins/PluginContext.ts
git commit -m "feat: add typed canvas events foundation"
```

---

## 完成标准

- [ ] `StoragePlugin.ts` under ~250 lines，只组装 API。
- [ ] `PluginManager.ts` under ~250 lines，只做门面。
- [ ] 插件 UI 可以注册 panel/toolbar/dialog，不再必须改 `Canvas.vue` 或 `Pannel.vue`。
- [ ] DOM/window/document listener 有统一 cleanup。
- [ ] ShortcutManager 跟随当前 CanvasRuntime，不是全局单例。
- [ ] 事件类型化有基础设施并开始使用。
- [ ] `pnpm build` 通过，现有测试通过。
