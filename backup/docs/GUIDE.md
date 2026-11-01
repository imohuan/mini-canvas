# Mini-Canvas 使用指南

## 目录结构

```
src/canvas/core/
├── runtime/          # 运行时核心：注入、事件、DOM 托管
├── registry/         # 注册表：节点、面板、工具栏、对话框
├── menu/             # 菜单系统：注册表 + 解析器
├── plugins/          # 插件：14 个功能插件 + 插件管理器
├── composables/      # 组合式函数：引导、连接、面板状态、快捷键等
├── nodes/            # 内置节点：text/image/video/stage 的组件和插件
├── components/       # 通用 UI：BaseNode、CanvasMenu、Pannel、面板 Tab
├── storage/          # 存储服务：AssetRuntimeService
├── types/            # 类型定义：CanvasNodeData
└── utils/            # 工具函数
```

---

## 一、核心概念

### 1. CanvasRuntime（运行时中枢）

所有组件和插件通过 `CanvasRuntime` 获取画布能力，不再用零散的 provide/inject。

```typescript
// runtime/CanvasRuntime.ts
class CanvasRuntime {
  pluginManager   // 插件管理器 → 调用 getPluginAPI()
  eventBus        // 事件总线 → 插件间通信
  nodeRegistry    // 节点注册表 → 动态获取节点组件
  menuRegistry    // 菜单注册表 → 右键菜单
  shortcutManager // 快捷键管理
  vueFlowInstance // VueFlow 实例
}
```

**获取方式：**

- 组件中：`const runtime = useCanvasRuntime()`
- 获取插件 API：`const storage = usePluginApi<StorageAPI>('storage')`

### 2. NodeRegistry（节点注册表）

替代原来 CustomNode.vue 里的硬编码映射。每个节点类型通过插件注册完整定义。

```typescript
// 注册一个节点
context.canvasNodes.register({
  type: 'image',                          // 业务类型名
  node: markRaw(ImageNode),               // 内容组件
  topToolbar: markRaw(ImageTopToolbar),   // 顶部工具栏
  bottomToolbar: markRaw(ImageBottomToolbar), // 底部工具栏
  label: '图片',                           // 显示名
  defaultSize: { cardWidth: 360, cardHeight: 270 }, // 默认尺寸
  menuItem: { label: '图片', description: '创建图片节点', icon: 'image' },
  canReceiveInput: true,                  // 是否可作为连线目标
  resizable: false,                       // 是否可调整大小
})
```

**规则：** VueFlow 渲染类型始终是 `type: 'custom'`，业务类型放在 `data.nodeType`。

### 3. PluginContext（插件上下文）

插件通过 `install(context)` 获取的能力清单：

| 属性 | 说明 |
|------|------|
| `context.canvasNodes` | 注册/查询节点类型 |
| `context.menus` | 注册右键菜单项 |
| `context.actions` | 增删节点/边 |
| `context.viewport` | 缩放、平移、聚焦 |
| `context.store` | 命名空间隔离的状态读写 |
| `context.selection` | 选中态管理 |
| `context.logger` | 带插件名前缀的日志 |
| `context.on/off/emit` | 事件监听与触发 |
| `context.getPluginAPI(name)` | 获取其他插件的公共 API |
| `context.registerShortcut(keys, handler)` | 注册快捷键 |
| `context.dom` | 统一的 DOM 监听（自动清理） |

---

## 二、如何添加新插件

### 步骤 1：创建插件文件

在 `src/canvas/core/plugins/` 下新建目录，比如 `my-plugin/`。

```
plugins/my-plugin/
├── MyPlugin.ts
└── index.ts
```

### 步骤 2：编写插件

```typescript
// MyPlugin.ts
import type { CanvasPlugin, PluginContext } from '../types'

export interface MyPluginAPI {
  doSomething(): void
}

export const MyPlugin: CanvasPlugin<{}, MyPluginAPI> = {
  name: 'my-plugin',
  version: '1.0.0',
  dependencies: [],  // 依赖的其他插件名，如 ['storage']

  install(context: PluginContext) {
    // 1. 注册快捷键
    context.registerShortcut('ctrl+m', () => {
      console.log('快捷键触发')
    }, '我的功能')

    // 2. 注册菜单
    context.menus.register([
      {
        id: 'my-action',
        label: '我的操作',
        group: 'action',
        visible: (ctx) => ctx.mode === 'node',
      },
    ])

    // 3. 监听事件
    const off = context.on('nodesChange', (changes) => {
      console.log('节点变了', changes)
    })

    // 4. 暴露 API 给其他插件
    const api: MyPluginAPI = {
      doSomething() { /* ... */ },
    }

    return {
      api,
      uninstall() {
        // 清理：取消事件、快捷键、DOM 监听
        off()
        context.menus.unregisterAll()
        context.unregisterShortcut('ctrl+m')
      },
    }
  },
}
```

```typescript
// index.ts
export { MyPlugin } from './MyPlugin'
```

### 步骤 3：注册到 App.vue

```typescript
// src/App.vue
import { MyPlugin } from './canvas/core/plugins/my-plugin/index'

const pluginSlots = ref([
  // ... 其他插件 ...
  {
    plugin: markRaw(MyPlugin),
    enabled: true,
    label: '我的插件',
    description: '插件说明',
    usage: '使用方法',
  },
])
```

插件会按依赖关系自动排序加载，无需手动管理顺序。

---

## 三、如何添加自定义节点类型

### 步骤 1：创建节点组件

在 `src/canvas/core/nodes/` 下新建目录：

```
nodes/my-node/
├── MyNode.vue           # 内容组件
├── MyTopToolbar.vue     # 顶部工具栏（可选）
├── MyBottomToolbar.vue  # 底部工具栏（可选）
└── index.ts             # 统一导出
```

```vue
<!-- MyNode.vue -->
<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
const props = defineProps<NodeProps>()
</script>

<template>
  <div class="my-node-content">
    {{ props.data?.label }}
  </div>
</template>
```

```typescript
// index.ts
export { default as MyNode } from './MyNode.vue'
export { default as MyTopToolbar } from './MyTopToolbar.vue'
export { default as MyBottomToolbar } from './MyBottomToolbar.vue'
```

### 步骤 2：编写节点插件

```typescript
// nodes/my-node/MyNodePlugin.ts
import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { MyNode, MyTopToolbar, MyBottomToolbar } from './index'

export const MyNodePlugin: CanvasPlugin = {
  name: 'node:my-node',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'my-node',
      node: markRaw(MyNode),
      topToolbar: markRaw(MyTopToolbar),
      bottomToolbar: markRaw(MyBottomToolbar),
      label: '我的节点',
      defaultSize: { cardWidth: 300, cardHeight: 200 },
      menuItem: { label: '我的节点', description: '创建自定义节点', icon: 'text' },
      canReceiveInput: true,
      resizable: true,
    })
    return {
      uninstall() { context.canvasNodes.unregister('my-node') },
    }
  },
}
```

### 步骤 3：注册到 App.vue

和普通插件一样，加到 `pluginSlots` 里即可。注册后：

- 右键画布菜单自动出现"我的节点"选项
- 拖线时自动出现连线菜单
- CustomNode.vue 自动从 NodeRegistry 找到对应组件渲染

---

## 四、如何添加自定义组件

### 1. 面板组件（Panel）

注册到右侧面板的某个 tab 下：

```typescript
// 在你的插件 install() 中
context.registerComponent('my-panel', MyPanelComponent)
```

面板组件通过 `PanelRegistry` 统一管理，Pannel.vue 会自动渲染已注册的面板。

### 2. 工具栏组件

通过 `ToolbarRegistry` 注册顶部/底部工具栏。

### 3. 对话框组件

通过 `DialogRegistry` 注册弹窗。

---

## 五、关键函数速查

### CanvasRuntime

| 函数 | 说明 |
|------|------|
| `useCanvasRuntime()` | 组件中获取 runtime |
| `usePluginApi<T>(name)` | 获取插件 API，如 `usePluginApi<StorageAPI>('storage')` |

### PluginContext

| 函数 | 说明 |
|------|------|
| `context.getPluginAPI<T>(name)` | 插件中获取其他插件 API |
| `context.canvasNodes.register(def)` | 注册节点类型 |
| `context.menus.register(items)` | 注册右键菜单项 |
| `context.actions.addNodes(nodes)` | 添加节点 |
| `context.actions.removeNodes(ids)` | 删除节点 |
| `context.actions.getNodes()` | 获取所有节点 |
| `context.actions.getEdges()` | 获取所有边 |
| `context.viewport.fitView()` | 适应视口 |
| `context.viewport.setCenter(x, y, zoom)` | 设置视口中心 |
| `context.on(event, handler)` | 监听事件，返回取消函数 |
| `context.emit(event, payload)` | 触发事件 |
| `context.registerShortcut(keys, fn, desc)` | 注册快捷键 |
| `context.dom.onDocument(type, fn)` | 安全监听 document 事件 |
| `context.dom.onWindow(type, fn)` | 安全监听 window 事件 |

### NodeRegistry

| 函数 | 说明 |
|------|------|
| `nodeRegistry.register(def)` | 注册节点定义 |
| `nodeRegistry.get(type)` | 获取节点定义 |
| `nodeRegistry.getDefaultSize(type)` | 获取默认尺寸 |
| `nodeRegistry.getLabel(type)` | 获取显示名 |
| `nodeRegistry.getMenuItems()` | 获取所有菜单项 |

### 事件列表

| 事件名 | 触发时机 | payload |
|--------|----------|---------|
| `nodesChange` | 节点变化 | `NodeChange[]` |
| `edgesChange` | 边变化 | `EdgeChange[]` |
| `nodeDragStop` | 节点拖拽结束 | - |
| `connect` | 连线完成 | `Connection` |
| `storage:status` | 存储状态变化 | `StorageStatus` |
| `storage:connected` | 文件系统已连接 | `{ workspaceName }` |
| `history:state-change` | 撤销/重做状态变化 | `{ isRestoring }` |
| `selection:change` | 选中变化 | `{ nodeIds, edgeIds }` |

---

## 六、插件间通信

插件之间通过两种方式通信：

**方式一：事件总线（推荐）**

```typescript
// 插件 A 发出事件
context.emit('my-event', { data: 123 })

// 插件 B 监听事件
const off = context.on('my-event', (payload) => {
  console.log(payload.data)
})
```

**方式二：直接调用 API**

```typescript
// 获取 StoragePlugin 的 API
const storage = context.getPluginAPI<StorageAPI>('storage')
if (storage) {
  await storage.saveCanvas(nodes, edges)
}
```

**注意：** 不再使用 `context.getPlugin('xxx')?.api`，这个旧写法只返回插件定义对象，拿不到 API。统一用 `getPluginAPI`。

---

## 七、常见问题

**Q: 为什么节点 type 是 'custom' 而不是 'image'？**

A: VueFlow 需要 `type: 'custom'` 来走 CustomNode.vue 渲染。业务类型放在 `data.nodeType`。保存时 `sanitizeForSave` 会清理运行时字段但保留这两个值。

**Q: 新节点注册后没出现在菜单里？**

A: 确认节点插件在 App.vue 的 `pluginSlots` 里，且 `enabled: true`。菜单项由 `NodeRegistry.getMenuItems()` 动态生成。

**Q: 怎么调试插件加载顺序？**

A: 打开控制台，搜索 `[PluginManager]`，会看到依赖排序后的加载顺序。也可以查看 `Canvas.vue` 中 `pluginLabels` 对象。

**Q: 插件卸载后 DOM 监听会清理吗？**

A: 通过 `context.dom.onDocument()` / `context.dom.onWindow()` 注册的监听会自动清理。直接 `document.addEventListener` 的需要在 `uninstall()` 中手动移除。