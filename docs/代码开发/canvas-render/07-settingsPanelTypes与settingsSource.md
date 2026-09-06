# canvas-render 开发手册 · settingsPanelTypes 与 settingsSource

> 来源：`packages/canvas-render/src/components/settingsPanelTypes.ts`、`components/settingsSource.ts`、
> 测试 `components/__tests__/settingsSource.test.ts`、内核 `core/settingsStore.ts`。

## 一句话

设置面板要做的事就是：把"内核配置单一数据源"变成一张**分组表单**给人改。为了让面板/宿主不必知道内核 `SettingsStore` 的完整 API，渲染层定义了一个**最小接口** `SettingsPanelSource`（settingsPanelTypes），又给了个**适配入口** `settingsSourceFrom(ctx)`（settingsSource），从 ctx 里把它现取出来。

---

## SettingsPanelSource —— 面板消费的最小接口

定义在 `settingsPanelTypes.ts`：

```ts
export interface SettingsPanelSource {
  /** 所有配置分组名（导航左侧 tab 用） */
  groups(): string[]
  /** 某一组的全部配置项（含当前值） */
  groupOf(group: string): SettingEntry[]
  /** 改一项的值（越界夹取）；返回是否真的变了 */
  set(key: string, value: string | number | boolean): boolean
  /** 订阅配置变化，返回取消句柄 */
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

// 复导出（来自内核）
export type { SettingSchema, SettingEntry }
```

内核 `SettingsStore` 已天然实现这些方法，所以这个接口是"类型收口 + 边界说明"。一个面板组件只要声明 `props.settings: SettingsPanelSource`，就能读分组/读项/改值/订阅，**不必知道 SettingsStore 的完整 API**。

配套的内核类型：
```ts
interface SettingSchema {
  type: 'color' | 'number' | 'select' | 'boolean' | 'text'
  default: string | number | boolean
  label?: string
  description?: string
  min?: number
  max?: number
  options?: Array<{ value: string; label?: string }>
}
interface SettingEntry {
  group: string
  key: string
  schema: SettingSchema
  value: string | number | boolean
}
```

---

## settingsSourceFrom —— 从 ctx 现取数据源

```ts
export function settingsSourceFrom(ctx: Context): SettingsPanelSource {
  const store = ctx.get<SettingsPanelSource>('settings')   // ctx.get('settings') 恒为内置 SettingsStore
  if (!store || typeof store.groups !== 'function') {
    throw new Error('[settingsSource] ctx 缺少 settings 服务…')
  }
  return store
}
```

- `ctx.get('settings')` 返回内核内置的 `SettingsStore`（单一数据源），它已经实现 `SettingsPanelSource` 的全部方法——所以这里直接返回，只做了类型收口与存在性校验。
- `ctx.settings`（能力段）是另一套读写入口，底层也指向同一个 SettingsStore。

---

## 谁用它

- `SettingsHost`：`const source = settingsSourceFrom(ctx)`，然后把 `source` 作为 `props.settings` 传给当前赢家面板。
- 宿主想自己直接渲染面板：`<PluginSettingsDialog :settings="settingsSourceFrom(ctx)" />`。

---

## 完整示例：写一个自定义设置面板组件

```vue
<script setup lang="ts">
// 自己实现一个 settingsPanel 槽的组件：声明 props.settings 即可
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

const props = defineProps<{ settings: SettingsPanelSource }>()

// SettingsStore 变更非响应式（plain class）→ 用 onChange 订阅 + 版本号驱动刷新
const ver = ref(0)
props.settings.onChange(() => { ver.value += 1 })
const groups = computed(() => props.settings.groups())
const entries = computed(() => groups.value.flatMap(g => props.settings.groupOf(g)))
</script>

<template>
  <div class="my-panel">
    <div v-for="e in entries" :key="e.key">
      <label>{{ e.schema.label ?? e.key }}</label>
      <button @click="settings.set(e.key, ...)">…</button>
    </div>
  </div>
</template>
```

然后插件里注册成 settingsPanel 赢家（order 更小顶替默认）：
```ts
ctx.theme.register('settingsPanel', MyPanel, { order: -1 })
```

---

## 坑

1. **SettingsStore 变更非响应式**（plain class）：面板不能靠 Vue 自动追踪，必须用 `onChange` 订阅 + 自己驱动刷新（version 号 / 手动改 ref）。
2. **`set` 未知 key 会抛错**：改一项前它必须已被声明（插件 Config schema 或 settings.define 登记过）。越界值会被夹取到 min/max。
3. **默认面板自刷新**：PluginSettingsDialog 内部已订阅 onChange，所以 SettingsHost 不会为每次配置变化给面板加 `:key` 重挂。
4. **settingsSourceFrom 在缺 settings 服务时抛错**：但 createMiniCanvasHost/CanvasHost 恒注入 settings，通常不会缺。
