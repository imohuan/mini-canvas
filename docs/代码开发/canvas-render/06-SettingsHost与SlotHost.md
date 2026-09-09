# canvas-render 开发手册 · SettingsHost（设置面板宿主）与 SlotHost（通用槽宿主）

> 来源：`packages/canvas-render/src/components/SettingsHost.vue`、`components/SlotHost.vue`、
> 内核 `core/capabilities.ts`（ctx.slots / ctx.theme）、`plugin-theme-default`（settings 注册、PluginSettingsDialog）。

## 一句话

两个组件是渲染层给你的"**UI 宿主**"：它们不写死任何界面，而是去读内核的注册表（slot/theme 里的 occupants），把当前该渲染的东西渲染出来。这样界面可由插件在运行时替换/叠加，宿主组件保持通用。

- **`SettingsHost`**：读 `themeRegistry.winner('settingsPanel')`，渲染"当前赢家的设置面板"，并把 `ctx.settings` 实时喂给它。
- **`SlotHost`**：给定槽名，把该槽里所有 occupant（插件 `ctx.slots.register` 塞的）按 order 渲染。

---

## 通用机制（两者共享）

两者都只在 **CanvasHost 的渲染子树 / 宿主业务 UI 区（`#ui`）** 内用——setup 里 `useCanvasRender()` 拿 ctx；组件树之外会抛错。都做同一套事：

1. setup 时读一次注册表（读当前 occupants / winner），把组件 `markRaw` 存进 ref（防 Vue reactive 化警告）。
2. 订阅内核事件 `ctx:plugin-installed` / `ctx:plugin-uninstalled`，插件装卸时**整体替换** ref → 触发 Vue 更新。
3. `onBeforeUnmount` 释放订阅。

---

## SettingsHost（可替换设置面板）

### 解决的重复

以前设置面板在 demo 里硬写 `<PluginSettingsPanel :settings="settingsStore"/>`，从没注册成槽 → 无法运行时替换。SettingsHost 把设置面板做成"**可替换皮**"（theme 单赢家槽 `settingsPanel`）。

### 用法

```vue
<SettingsHost empty-hint="暂无设置面板" />
```

### 它内部做什么

```ts
const { ctx } = useCanvasRender()
const source = settingsSourceFrom(ctx)          // 把 ctx.get('settings') 适配成最小面板接口

function reload() {
  const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
  const w = theme?.winner('settingsPanel')       // 取当前赢家
  winner.value = w ? markRaw(w as object) : undefined
}
reload()
// 订阅插件装卸 → reload
```

模板：
```html
<component v-if="winner" :is="winner" :settings="source" />
<div v-else-if="emptyHint" class="sh-empty">{{ emptyHint }}</div>
```

关键语义：
- **数据喂法 = 渲染时现取，不注册快照**：`ctx.settings` 是画布级恒在数据，现取保证实时。
- 面板组件声明 `props.settings` 接收。
- **设置值自刷新由面板自己负责**：SettingsHost 不监听配置变化给面板加 `:key` 重挂（否则输入框每按键就重挂丢焦点）。默认面板 PluginSettingsDialog 内部已订阅 onChange 自刷新。
- 插件换皮：装一个 order 更小的插件 `ctx.theme.register('settingsPanel', 新组件, { order: -1 })` 即顶替默认。

### 默认皮从哪来

`plugin-theme-default` 在 `apply(ctx)` 里注册：
```ts
ctx.theme.register('settingsPanel', PluginSettingsDialog, { id: 'default', order: 0 })
```
它实现了一个"居中 modal + 左右布局"的标准设置界面（左导航 / 右内容），还带两个可扩展插槽（见《07 的槽名表》）。

### props

```ts
{ emptyHint?: string }   // 空槽时是否显示占位文案
```

---

## SlotHost（通用 UI 槽宿主）

### 解决的重复

以前渲染"一个槽"（如 overlay）要在宿主组件里手抄一整套：读 occupants → 维护响应式列表 → 订阅装卸 → markRaw → 逐个 `<component :is>`。抽成 SlotHost 后，渲染任意槽只需一行：

```vue
<SlotHost slot="overlay" />        <!-- 插件侧 ctx.slots.register('overlay', {component, order}) -->
<SlotHost slot="toolbar" />        <!-- 想加新槽，多写一行就多一个可扩展区 -->
```

### 它内部做什么

```ts
const { ctx } = useCanvasRender()

function reload() {
  list.value = ctx.slots
    .occupants(props.slot)                       // 读该槽所有 occupant
    .map(e => ({ id: e.id, order: e.order, component: markRaw(e.component) }))
}
reload()
// 订阅插件装卸 → reload
watch(() => props.slot, reload)                  // props.slot 变更时重读
```

模板按 order 逐个渲染：
```html
<component v-for="oc in list" :key="oc.id" :is="oc.component"
           :class="itemClass" :data-slot-order="oc.order" :data-slot-id="oc.id" />
```

### props

```ts
{ slot: string, itemClass?: string }
```
`slot` 要与插件 `ctx.slots.register` 用的槽名一致。`itemClass` 可给每个 occupant 根元素加 class（如 overlay 的 pointer-events 规则）。

### 使用方要自己套布局 CSS

SlotHost **不做定位/pointer-events/容器样式**——那是具体槽（如 overlay 盖满画布那层）的职责，由使用方套 CSS。比如 CanvasSurface 里 overlay 是这样用的：

```html
<div class="csurface-overlay">   <!-- absolute + inset:0 + pointer-events:none -->
  <SlotHost slot="overlay" item-class="csurface-overlay-item" />
</div>
```
浮层里的 occupant 要能点：容器 pointer-events:none，`item-class` 恢复 auto（`.csurface-overlay .csurface-overlay-item { pointer-events: auto }`）。

---

## 槽名总览（SlotName）

### 主题槽（ThemeSlot，给 CanvasHost 装配用）

内核 `themeRegistry.ts` 定义，节点壳/边/背景走这些：

| 槽名 | 值类型 | 谁消费 | 谁提供（theme-default） |
|------|--------|--------|----------------------|
| `nodeShell` | 组件 | VueFlow node-types（节点壳，铺满业务 type） | `BaseNode` |
| `edge` | 组件 | VueFlow edge-types（`edgeTypes.custom`） | `CustomEdge` |
| `background` | 组件 | VueFlow 背景 | `DefaultBackground` |
| `edgeDefaultType` | 字面值(默认 'custom') | 建边时默认 type | `'custom'` |
| `settingsPanel` | 组件 | SettingsHost 的赢家 | `PluginSettingsDialog` |
| `connectionLine` | 组件 | VueFlow 拖线时的"待连预览线"渲染 | （theme-default 未填，缺省） |

> 内核 `ThemeSlot` 类型另含 `connectionLine` 一槽（拖拽连线的预览线渲染组件），`ThemeSlot` 也允许任意字符串新槽。
> 上面 5 个是 theme-default 实际注册/装配在用的一组。

这些是 single 语义（`winner(slot)` 取 order 最小者），theme-default 用 `ctx.theme.register` 注册。插件还能声明任意字符串新槽。

### 通用 UI 槽（ctx.slots，给 SlotHost / 设置面板用）

| 槽名 | 谁读 | 插件怎么填（示例） |
|------|------|------------------|
| `overlay` | CanvasSurface 里的 `<SlotHost slot="overlay">` | `ctx.slots.register('overlay', { component, order })` |
| `settingsNav` | PluginSettingsDialog 左导航 | 塞自定义**一级**导航项 / 顶替某一级 tab（id = 一级名，命中顶替，否则末尾追加自定义一级项） |
| `settingsTab` | PluginSettingsDialog 二级页签条 | 定制**二级**页签：id 首段 = 当前一级名才生效；id 命中该一级下某完整分组 key → 顶替那个二级页签，否则追加一个自定义二级页签 |
| `settingsGroup/<key>` | PluginSettingsDialog 右内容 | 接管某**完整 key**（扁平分组名或带 `/` 的二级叶子全名）的内容区（meta.mode: replace/prepend/append） |

> 分组 key 语义：字段 `group` 可用 `/` 表示二级菜单，如 `常规/显示` → 左导航一级=`常规`，右页面签=二级分组。某一级下二级分组**多于一个**才显示页签条；只有一个则无页签直接展示正文。扁平分组（无 `/`）即一级=自己，行为同旧版。

> 更通用的：`slotRegistry`/`SlotRegistry` 允许多 occupant 按 order 叠加；`themeRegistry` 基于它实现（单格换肤=winner，装饰层=occupants 全量）。

---

## 端到端：怎么让"设置"能改边外观

1. `plugin-theme-default` `apply`：注册 `settingsPanel` 赢家（PluginSettingsDialog）+ `Config` schema（连线/背景各项）。
2. 内核启动时：Config schema 字段自动登记进 `settings` 单一数据源（scope=theme-default）。
3. 宿主想显示设置：在自己业务 UI 区放 `<SettingsHost/>`（或直接 `<PluginSettingsDialog :settings="settingsSourceFrom(ctx)" />`）。
4. 面板里调 `settings.set(key, value)` 或走插槽自定义组件 → onChange → 外观就地窄更新实时生效（不整图重建）。

---

## 坑

1. **两个宿主都只能在 CanvasHost 子树 / `#ui` 区里用**（依赖 useCanvasRender）。放 CanvasHost 外面会抛错。
2. **SlotHost 只渲染，不定位**：给 occupant 的 pointer-events/布局要靠使用方套 CSS + itemClass。
3. **设置面板别用 `:key` 重挂**：输入框每按键会丢焦点。要面板自己订阅 onChange 自刷新。
4. **occupant 组件句柄要 markRaw**：组件内部（SettingsHost/SlotHost）已处理；你自己手写渲染槽时要记得。
5. **`settingsNav`/`settingsGroup/<key>` 是设置面板(PluginSettingsDialog)内部的插槽**，不是 SlotHost 渲染的通用槽——要跟通用 `overlay`/任意自定义槽区分开。
