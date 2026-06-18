# 插件架构设计

> 核心理念：**把每个功能做成独立的插件，像搭积木一样组装画布。**

---

## 一、设计目标

### 1.1 核心原则

| 原则 | 含义 |
|------|------|
| **可插拔** | 每个功能独立打包，加/删不影响其他功能 |
| **可组合** | 插件可以声明依赖，自动处理加载顺序 |
| **可扩展** | 第三方可以写插件，不修改核心代码 |
| **可测试** | 每个插件可以独立测试，有 mock PluginContext |
| **最小侵入** | 插件不修改 VueFlow 源码，只在"钩子点"扩展 |

### 1.2 目标使用方式

```typescript
// 用户代码（Canvas.vue 或配置文件）
import { createCanvas } from '@/canvas'
import { MultiSelectPlugin } from '@/plugins/multi-select'
import { ClipboardPlugin } from '@/plugins/clipboard'
import { HistoryPlugin } from '@/plugins/history'
import { GroupPlugin } from '@/plugins/group'
import { AlignGuidePlugin } from '@/plugins/align-guide'

const canvas = createCanvas({
  container: '#app',
  plugins: [
    MultiSelectPlugin,
    ClipboardPlugin,
    HistoryPlugin,
    GroupPlugin({ maxDepth: 3 }),   // 支持选项
    AlignGuidePlugin,
  ]
})
```

---

## 二、核心架构

### 2.1 整体分层

```
┌─────────────────────────────────────────────┐
│                 应用层                        │
│    Canvas.vue (薄容器) + 插件配置              │
├─────────────────────────────────────────────┤
│               插件管理层                       │
│    PluginManager (加载/生命周期/依赖)          │
├─────────────────────────────────────────────┤
│                插件层                          │
│    Clipboard │ History │ MultiSelect │ ...    │
│    每个插件 = composable + 组件 + 配置         │
├─────────────────────────────────────────────┤
│               适配层                           │
│    PluginContext (API 入口)                   │
│    封装 VueFlow API + 提供插件专用能力         │
├─────────────────────────────────────────────┤
│                Vue Flow                        │
│    (未经修改的原生 VueFlow)                    │
└─────────────────────────────────────────────┘
```

**关键：适配层隔离插件和 VueFlow。** 插件不直接调 `useVueFlow()`，而是通过 `PluginContext` 获取能力。这样如果以后换库（如换 react-flow），只需改适配层。

### 2.2 插件管理器 (PluginManager)

```typescript
class PluginManager {
  private plugins: Map<string, CanvasPlugin>
  private contexts: Map<string, PluginContext>
  private loadOrder: string[]   // 拓扑排序后的加载顺序
  
  async install(config: CanvasConfig): Promise<void>
  async uninstall(pluginName: string): Promise<void>
  getPlugin<T>(name: string): T | null
  getContext(name: string): PluginContext | null
}
```

**加载流程：**

```
1. 解析所有插件，检查重复名称
2. 解析依赖，构建依赖图
3. 拓扑排序，检测循环依赖
4. 按序创建 PluginContext（注入 API）
5. 按序调用 plugin.install(context)
6. 如果任何插件 install 失败 → 回滚已安装的插件
7. 触发 onAllPluginsReady 事件
```

**卸载流程：**

```
1. 检查是否有其他插件依赖此插件
2. 逆序调用 plugin.uninstall()
3. 清理插件注册的事件/hooks/组件
4. 清理插件渲染的 DOM
```

### 2.3 插件接口 (CanvasPlugin)

```typescript
interface CanvasPlugin<T extends Record<string, unknown> = {}> {
  /** 插件唯一标识 */
  name: string
  
  /** 语义化版本 */
  version?: string
  
  /** 依赖的其他插件名称 */
  dependencies?: string[]
  
  /** 插件选项类型 */
  options?: T
  
  // === 生命周期 ===
  
  /** 安装：在此注册事件、hooks、组件 */
  install(context: PluginContext, options: T): void | Promise<void>
  
  /** 卸载：清理资源 */
  uninstall?(): void | Promise<void>
  
  /** 激活（从暂停恢复） */
  activate?(): void
  
  /** 停用（暂停但不卸载） */
  deactivate?(): void
}
```

### 2.4 插件上下文 (PluginContext)

这是插件的"世界"——插件能做什么，全在这里定义。

```typescript
interface PluginContext {
  // === 画布实例标识 ===
  readonly canvasId: string
  
  // === VueFlow API（封装后的） ===
  readonly store: CanvasStore          // 状态读写
  readonly actions: CanvasActions      // 操作方法
  readonly viewport: ViewportAPI       // 视口控制
  
  // === 组件注册 ===
  registerNodeType(name: string, component: Component): void
  registerEdgeType(name: string, component: Component): void
  registerComponent(name: string, component: Component): void
  
  // === 事件系统 ===
  on(event: string, handler: Function): void
  off(event: string, handler: Function): void
  emit(event: string, payload: any): void
  
  // === DOM 钩子 ===
  mountOverlay(el: HTMLElement | Component, target: 'viewport' | 'canvas' | 'root'): void
  unmountOverlay(el: HTMLElement | Component): void
  
  // === 快捷键 ===
  registerShortcut(keys: string, handler: () => void, description?: string): void
  unregisterShortcut(keys: string): void
  
  // === 日志 ===
  logger: Logger
  
  // === 其他插件 ===
  getPlugin<T>(name: string): T | null
}
```

---

## 三、插件通信机制

### 3.1 事件总线（插件间直接通信）

```typescript
// 剪贴板插件发布事件
context.emit('clipboard:copy', { nodes, edges })

// 历史记录插件监听事件
context.on('clipboard:paste', (data) => {
  this.saveSnapshot('paste')
})
```

### 3.2 事件命名规范

```
{namespace}:{action}

示例：
  clipboard:copy
  clipboard:paste
  selection:change
  selection:box-start
  group:create
  group:ungroup
  history:undo
  history:redo
```

### 3.3 共享状态（通过 Store）

Pinia store 仍然是跨插件共享状态的最佳方式（已验证可行）。但每个插件应该声明自己的状态命名空间：

```typescript
// clipboard plugin 在 store 中的命名空间
store.clipboard = {
  data: null,
  lastCopyTime: 0,
}
```

### 3.4 直接引用（获取其他插件的 API）

```typescript
// group plugin 依赖 multi-select plugin
install(context: PluginContext) {
  const multiSelect = context.getPlugin<MultiSelectAPI>('multi-select')
  if (!multiSelect) throw new Error('multi-select not installed')
  
  // 使用 multi-select 的公开 API
  multiSelect.onSelectionChange((nodes) => {
    this.updateGroupToolbar(nodes)
  })
}
```

---

## 四、关键设计决策

### 4.1 为什么不直接让插件调 `useVueFlow()`？

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接调 `useVueFlow()` | 简单 | 插件和 VueFlow 强绑定，换库全废；无法 mock 测试 |
| 通过 PluginContext | 解耦、可测试、可扩展 | 需要封装一层 |

**选 PluginContext。** 封装成本很低，收益巨大——将来如果换引擎，只需改一个地方。

### 4.2 为什么用 Pinia 而不是 PluginContext 传状态？

- Pinia = 已验证可行（旧项目大量使用）
- Pinia = devtools 支持（调试更方便）
- Pinia = 持久化方便（useStorage 插件）

PluginContext 只提供"能力"（函数、类），不提供"状态"。

### 4.3 组件渲染位置问题

旧实现的痛点：不同组件需要渲染在不同 DOM 层。

**解决方案：`mountOverlay()` 方法**

```typescript
// 渲染到 VueFlow viewport 层（随画布缩放/平移）
context.mountOverlay(AlignmentLines, 'viewport')

// 渲染到画布容器层（不随画布缩放，但定位在画布上方）
context.mountOverlay(NodeContextMenu, 'canvas')

// 渲染到根节点（如全局对话框、快捷键提示）
context.mountOverlay(ShortcutDialog, 'root')
```

内部实现：根据 target 自动选择 Teleport 目标选择器。

---

## 五、插件分类

### 5.1 按功能域分类

| 类别 | 插件示例 | 依赖 |
|------|----------|------|
| **交互类** | MultiSelect, DragBehavior | 无 |
| **显示类** | AlignmentGuide, MiniMap, Grid | 无 |
| **操作类** | Clipboard, History, AutoSave | 无 |
| **节点类** | CustomHandle, Group, NodeToolbar | MultiSelect（Group） |
| **系统类** | ShortcutManager, Logger, Storage | 无 |

### 5.2 内置插件 vs 第三方插件

| | 内置插件 | 第三方插件 |
|------|----------|------------|
| **位置** | `src/plugins/` | `src/plugins/community/` |
| **维护者** | 核心团队 | 社区 |
| **API 稳定性** | 高 | 可能有破坏性变更 |

---

## 六、启动流程

```
应用启动
  → createCanvas(options)
    → PluginManager.install(options.plugins)
      → 解析依赖图 → 拓扑排序
      → 创建 PluginContext (含 Store 初始化)
      → 依次调用 plugin.install(ctx)
        → 插件注册 node/edge types
        → 插件注册事件监听
        → 插件渲染 overlay 组件
      → 所有插件就绪
    → 渲染 Canvas.vue
      → 渲染 VueFlow 组件
      → 传递 nodeTypes/edgeTypes (来自 PluginContext)
      → VueFlow 初始化完成
    → 触发 onCanvasReady
```

---

## 七、为什么要这样设计？

### 对比：旧架构 vs 新架构

| 维度 | 旧架构 | 新架构 |
|------|--------|--------|
| 添加功能 | 改 CanvasPage + 新 composable | 写一个 plugin 文件，注册即可 |
| 删除功能 | 几乎不可能（功能耦合） | 从 plugins 数组中移除 |
| 功能冲突 | 全局变量互相干扰 | 插件内状态隔离 + 事件命名空间 |
| 加载顺序 | 靠"碰巧对"的代码顺序 | 拓扑排序，依赖声明 |
| 测试 | 几乎不可能 | 每个插件独立测试 |
| 第三方扩展 | 不可能 | 提供 Plugin API 文档即可 |
| 代码组织 | 所有 composable 平铺 | 每个插件独立目录 |

### 对比：直接用 VueFlow 的 hooks 扩展 vs Plugin API

| 维度 | 直接 hooks | Plugin API |
|------|-----------|------------|
| 学习成本 | 低（VueFlow 文档） | 中（Plugin API 文档） |
| 重用性 | 低（copy-paste 代码） | 高（一个文件即可） |
| 解耦程度 | 低（深度依赖 VueFlow） | 高（可适配其他引擎） |
| 功能发现 | 靠代码搜索 | 插件列表一目了然 |
| 禁用功能 | 删除/注释代码 | `plugins: []` 中移除 |
