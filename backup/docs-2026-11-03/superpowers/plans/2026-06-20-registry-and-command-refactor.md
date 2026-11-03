# Registry & Command 系统重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将画布的"注册体系"统一成"命令（Command）为中枢 + 菜单/Toolbar/快捷键作为触发入口"的架构，并整理 `canvas.state` 为 `core + plugins` 嵌套结构。

**Architecture:**
- 引入 `CommandRegistry`，所有可执行能力（undo/copy/paste...）注册成 `CanvasCommand`，携带 `title/icon/keybinding/visible/disabled/run`。
- 菜单项、Toolbar 按钮、快捷键退化为"命令的触发入口"，通过 `commandId` 引用命令。
- 统一所有 Registry 的字段命名：`title / run / order / source / nodeTypes / visible / disabled`。
- `canvas.state` 重构为 `{ core: {...}, plugins: {...} }`。
- `PanelRegistry` 改为注册"全局设置项"（JSON schema），值存入 `canvas.state.plugins`，返回响应式 `Ref`。

**Tech Stack:** Vue 3.5 + TypeScript + Pinia + node:test

---

## 现状速查

| 主题 | 文件 | 关键事实 |
|------|------|---------|
| 节点注册 | `registry/NodeRegistry.ts` | 用 `label`，无 `source`/`order` |
| 菜单注册 | `menu/MenuRegistry.ts` + `MenuResolver.ts` | 用 `label`/`priority`/`visible(ctx)`，有 `source` |
| 快捷键 | `plugins/ShortcutManager.ts` | 用 `command`/`handler`/`priority`/`pluginId` |
| Toolbar | `registry/ToolbarRegistry.ts` | 死代码，零引用 |
| Panel | `registry/PanelRegistry.ts` | 死代码，零引用 |
| Dialog | `registry/DialogRegistry.ts` | 死代码，零引用，本次不动 |
| 插件 API | 各插件 `install()` 返回 `{ api }` | `getPluginAPI('history').undo()` 散装调用 |
| canvas.state | `composables/useCanvasStore.ts` | 平铺结构，`useStorage` 持久化 |
| Runtime | `runtime/CanvasRuntime.ts` | 持有 `nodeRegistry`/`menuRegistry` |
| Canvas.vue | L1114-L1116 | 实例化 registry、创建 runtime |
| PluginContext | `plugins/PluginContext.ts` | 暴露 `canvasNodes`/`menus`/`registerShortcut` |

---

## 文件结构

### 新建
```
src/canvas/core/registry/
  CommandRegistry.ts          # 命令注册中心
  CommandRegistry.test.ts
  types.ts                    # 已创建
  ToolbarRegistry.test.ts
  PanelRegistry.test.ts

src/canvas/core/components/toolbar/
  BaseToolbar.vue             # 默认工具栏

src/canvas/core/components/panel/
  DynamicSettingsPanel.vue    # JSON 驱动设置面板
  DynamicSettingField.vue     # 单个字段渲染器
```

### 修改
```
registry/NodeRegistry.ts              # +source/order 字段
registry/ToolbarRegistry.ts           # 重写：引用 commandId
registry/PanelRegistry.ts             # 重写：全局设置项
menu/MenuRegistry.ts                  # 统一字段名
menu/MenuResolver.ts                  # 适配新字段
plugins/PluginContext.ts              # 暴露 commands/toolbars/panels
plugins/types.ts                      # PluginContext 接口
plugins/PluginManager.ts              # 卸载时清理注册
runtime/CanvasRuntime.ts              # 持有新 registry
composables/useCanvasStore.ts         # state → core+plugins
components/CustomNode.vue             # 插槽化 toolbar
Canvas.vue                            # 实例化新 registry
components/CanvasMenu.vue             # 亮色动效风格
plugins/context-menu/builtinMenuItems.ts  # 引用 commandId
```

---

## Task 1: 定义统一的注册项类型

**状态:** 已完成

**文件:** `src/canvas/core/registry/types.ts` (已创建)

定义了 `CommandContext`、`BaseRegistryItem`、`CanvasCommand`、`MenuItemDefinition`、`ToolbarButtonDefinition`、`PanelSettingDefinition` 以及各 Registry 的 API 接口。

**关键设计决策:**
- 执行函数统一叫 `run`（参考 Monaco）
- 排序统一叫 `order`
- 标题统一叫 `title`
- 来源统一叫 `source`
- `visible`/`disabled` 支持布尔值或函数
- 菜单/Toolbar 通过 `commandId` 引用命令

---

## Task 2: 实现 CommandRegistry

**文件:** `registry/CommandRegistry.ts` + `CommandRegistry.test.ts`

**核心代码:**

```ts
export class CommandRegistry implements CommandRegistryAPI {
  private commands = reactive(new Map<string, CanvasCommand>())

  register(command: CanvasCommand): void {
    const existing = this.commands.get(command.id)
    if (existing) {
      console.warn(
        `[CommandRegistry] Command "${command.id}" is overridden: ` +
        `"${existing.source}" -> "${command.source}"`
      )
    }
    this.commands.set(command.id, { ...command })
  }

  unregister(id: string): void { this.commands.delete(id) }

  unregisterSource(source: string): void {
    for (const [id, cmd] of this.commands) {
      if (cmd.source === source) this.commands.delete(id)
    }
  }

  async execute(id: string, ctx: CommandContext, args?: unknown): Promise<void> {
    const cmd = this.commands.get(id)
    if (!cmd) throw new Error(`Command not found: "${id}"`)
    try { await cmd.run(ctx, args) }
    catch (err) { ctx.logger?.error?.(`Command "${id}" failed:`, err) }
  }

  canExecute(id: string, ctx?: CommandContext): boolean {
    const cmd = this.commands.get(id)
    if (!cmd) return false
    if (cmd.disabled === undefined) return true
    if (typeof cmd.disabled === 'boolean') return !cmd.disabled
    try { return !cmd.disabled(ctx!) } catch { return false }
  }

  has(id: string): boolean { return this.commands.has(id) }
  get(id: string): CanvasCommand | null { return this.commands.get(id) ?? null }

  getPublic(): CanvasCommand[] {
    const result: CanvasCommand[] = []
    for (const cmd of this.commands.values()) { if (cmd.title) result.push(cmd) }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  getAll(): CanvasCommand[] { return [...this.commands.values()] }
}
```

**测试用例 (9个):**
1. register and execute - 注册并执行命令
2. execute unknown command throws - 不存在的命令抛错
3. unregister removes command - 注销后 has() 返回 false
4. unregisterSource removes all from source - 按来源批量注销
5. getPublic returns only commands with title - 过滤公开命令
6. duplicate id overwrites - 同 id 覆盖并触发新 handler
7. canExecute respects disabled - disabled 为 true 时不可执行
8. visible command still executable via code - visible 不影响代码执行
9. execute catches run errors - run 报错被 logger 捕获

---

## Task 3: 重写 ToolbarRegistry

**文件:** `registry/ToolbarRegistry.ts` (修改) + `ToolbarRegistry.test.ts` (新建)

**核心代码:**

```ts
export class ToolbarRegistry implements ToolbarRegistryAPI {
  private buttons = reactive(new Map<string, ToolbarButtonDefinition>())

  register(source: string, button: ToolbarButtonDefinition): void {
    const existing = this.buttons.get(button.id)
    if (existing) console.warn(`[ToolbarRegistry] Button "${button.id}" overridden`)
    this.buttons.set(button.id, { ...button, source })
  }

  unregister(id: string): void { this.buttons.delete(id) }

  unregisterSource(source: string): void {
    for (const [id, btn] of this.buttons) {
      if (btn.source === source) this.buttons.delete(id)
    }
  }

  getByPosition(position: 'top' | 'bottom'): ToolbarButtonDefinition[] {
    const result: ToolbarButtonDefinition[] = []
    for (const btn of this.buttons.values()) {
      if (btn.position === position) result.push(btn)
    }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  getAll(): ToolbarButtonDefinition[] { return [...this.buttons.values()] }
}
```

**和旧版的区别:**
- 旧版注册的是 `{ component: Vue组件 }`，新版注册的是 `{ commandId, position, nodeTypes }`
- 按钮不再直接持有组件，而是引用命令 ID
- 新增 `getByPosition()` 按上下位置过滤

---

## Task 4: 重写 PanelRegistry

**文件:** `registry/PanelRegistry.ts` (修改) + `PanelRegistry.test.ts` (新建)

**核心代码:**

```ts
export class PanelRegistry implements PanelRegistryAPI {
  private settings = reactive(new Map<string, PanelSettingDefinition>())

  registerSetting(source: string, setting: PanelSettingDefinition): void { ... }
  unregisterSetting(id: string): void { ... }
  unregisterSource(source: string): void { ... }
  getAll(): PanelSettingDefinition[] { ... }
  getBySource(source: string): PanelSettingDefinition[] { ... }

  /**
   * 获取设置项的响应式值
   * id 格式: 'theme.accent' 或 'theme.colors.accent'
   * 第一段是 plugins 下的命名空间，后续段是嵌套路径
   */
  useValue<T>(
    id: string,
    store: Ref<Record<string, Record<string, unknown>>>,
    defaultValue: T
  ): Ref<T> {
    const parts = id.split('.')
    const namespace = parts[0]
    const pathParts = parts.slice(1)

    if (!store.value[namespace]) store.value[namespace] = {}

    let current = store.value[namespace]
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) current[pathParts[i]] = {}
      current = current[pathParts[i]] as Record<string, unknown>
    }

    const leafKey = pathParts[pathParts.length - 1]
    if (current[leafKey] === undefined) current[leafKey] = defaultValue

    return computed<T>({
      get: () => { /* 从 store 读取 */ },
      set: (val) => { /* 写入 store */ },
    }) as Ref<T>
  }
}
```

**关键设计:**
- `useValue()` 返回 `computed` ref，双向绑定
- id 用 dotted path 映射到 `canvas.state.plugins.<namespace>`
- 默认值只在首次写入，不覆盖已有值
- 插件卸载时 `unregisterSource` 只清理注册定义，不删除已保存的值

---

## Task 5: 重构 canvas.state 为 core + plugins

**文件:** `composables/useCanvasStore.ts`

**改动:** 原有平铺结构改为:

```ts
const state = ref({
  core: {
    edgeLineWidth: 2,
    edgeColor: '#3b82f6',
    // ... 所有原有字段
  },
  plugins: {} as Record<string, Record<string, unknown>>
})
```

**兼容策略:**
- serializer.read() 检测旧格式平铺数据，自动迁移到 core
- serializer.write() 只写新格式
- 所有引用 `canvas.state.xxx` 的地方改为 `canvas.state.core.xxx`

---

## Task 6: 更新 CanvasRuntime

**文件:** `runtime/CanvasRuntime.ts`

新增三个 readonly 字段: `commandRegistry`、`toolbarRegistry`、`panelRegistry`

---

## Task 7: PluginContext 暴露新 API

**文件:** `plugins/types.ts` + `plugins/PluginContext.ts` + `plugins/PluginManager.ts`

新增三个 API 命名空间:

```ts
ctx.commands.register({ id: 'history.undo', title: '撤销', run: ... })
ctx.toolbars.register('image-tools', { commandId: 'image.crop', position: 'top' })
ctx.panels.registerSetting('theme', { id: 'theme.accent', type: 'color', ... })
```

PluginManager stub context 同步添加空实现。

---

## Task 8: Canvas.vue 接入

**文件:** `Canvas.vue`

```ts
const commandRegistry = new CommandRegistry()
const toolbarRegistry = new ToolbarRegistry()
const panelRegistry = new PanelRegistry()
const runtime = new CanvasRuntime(manager, ..., commandRegistry, toolbarRegistry, panelRegistry, ...)
```

同时传入 `createPluginContext`。

---

## Task 9: BaseToolbar 组件

**文件:** `components/toolbar/BaseToolbar.vue`

- 接收 `position: 'top' | 'bottom'` prop
- 从 `runtime.toolbarRegistry.getByPosition(position)` 获取按钮
- 过滤 `nodeTypes`：当前节点类型不在列表中的跳过
- 点击 → `runtime.commandRegistry.execute(btn.commandId, ctx)`
- 无按钮时不渲染 DOM
- 样式：亮色玻璃拟态

---

## Task 10: CustomNode 插槽化

**文件:** `components/CustomNode.vue`

```vue
<template>
  <BaseNode v-bind="$props">
    <template #top-toolbar>
      <slot name="top-toolbar">
        <BaseToolbar position="top" v-bind="$props" />
      </slot>
    </template>
    <template #content>...</template>
    <template #bottom-toolbar>
      <slot name="bottom-toolbar">
        <BaseToolbar position="bottom" v-bind="$props" />
      </slot>
    </template>
  </BaseNode>
</template>
```

- 有插槽 → 自定义 toolbar
- 没插槽 → 默认 BaseToolbar
- 不再从 NodeRegistry 读取 topToolbar/bottomToolbar

---

## Task 11: CanvasMenu 亮色动效

**文件:** `components/CanvasMenu.vue`

- 背景: `rgba(255,255,255,0.82)` + `backdrop-filter: blur(20px)`
- 圆角: 16px
- 阴影: `0 20px 40px rgba(0,0,0,0.08)`
- 文字: `#374151`
- 弹出动画: `<Transition name="menu-pop">` (scale + translateY)
- 菜单项逐个淡入: CSS animation with `--item-index` delay
- `prefers-reduced-motion` 时禁用动画

---

## Task 12: NodeRegistry 加 source/order

**文件:** `registry/NodeRegistry.ts`

```ts
interface CanvasNodeDefinition {
  source?: string
  order?: number
  // ... 原有字段
}
```

暂不改 `label` -> `title`，避免破坏现有菜单。

---

## Task 13: History 插件迁移示例

**文件:** `plugins/history/HistoryPlugin.ts`

```ts
context.commands.register({
  id: 'history.undo',
  source: 'history',
  title: '撤销',
  category: '编辑',
  keybinding: 'ctrl+z',
  order: 10,
  run: () => api.undo(),
})

context.commands.register({
  id: 'history.record',
  source: 'history',
  run: (_ctx, args) => api.record(args),
})
```

保留原有 `registerShortcut`，渐进迁移。

---

## Task 14: keybinding 自动绑定

**CommandRegistry 扩展:**

```ts
setShortcutManager(mgr): void
// register() 时检测 keybinding -> 自动注册到 ShortcutManager
// unregister()/unregisterSource() 时自动解绑
```

在 `PluginContext` 和 `Canvas.vue` 中注入 `ShortcutManager.getInstance()`。

---

## Task 15: 插件卸载清理

**PluginManager.uninstall() 新增:**

```ts
this.commandRegistry?.unregisterSource(pluginName)
this.toolbarRegistry?.unregisterSource(pluginName)
this.panelRegistry?.unregisterSource(pluginName)
```

**Canvas.vue 中注入:**

```ts
manager.setRegistries({ commandRegistry, toolbarRegistry, panelRegistry })
```

---

## Task 16: DynamicSettingsPanel

**DynamicSettingField.vue** - 按 type 渲染:
- text -> `<input type="text">`
- number -> `<input type="number">`
- boolean -> toggle 开关
- select -> `<select>`
- color -> `<input type="color">`
- slider -> `<input type="range">` + 数值显示

**DynamicSettingsPanel.vue** - 从 PanelRegistry 读取所有设置项，按 group 分组渲染。

---

## Task 17: 全量验证

- 运行所有单元测试
- vue-tsc 编译检查
- dev 手动验证：节点渲染、右键菜单、撤销重做、复制粘贴、连线、拖拽、缩放

---

## 后续迁移（不在本计划内）

1. 其他插件（Clipboard/Group/AutoLayout）迁移到命令注册
2. 菜单项改为 `{ commandId: 'history.undo', areas: ['node'] }` 形式
3. `core/menu/` 目录合并到 `plugins/context-menu/`
4. 命令面板（Ctrl+Shift+P）
5. 删除 NodeRegistry 的 topToolbar/bottomToolbar 字段
6. 删除旧的 registerShortcut 调用
7. DialogRegistry 等使用场景明确后再设计
