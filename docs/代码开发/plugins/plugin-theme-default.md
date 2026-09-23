# plugin-theme-default —— 默认主题/默认「皮」插件用法（重点：它占的槽与它开的插槽）

> 来源：`packages/plugins/plugin-theme-default/src/index.ts`（插件主文件 + Config + 默认值常量）、
> `src/components/settings/PluginSettingsDialog.vue`（默认设置面板 = 扩展插槽的宿主）、
> `src/components/node/BaseNode.vue` 等六个核心渲染件。
> 相关底层：`canvas-data/主题换肤ctx-theme与ThemeRegistry.md`、`canvas-data/通用UI槽ctx-slots与命令ctx-commands.md`、
> `canvas-render/06-SettingsHost与SlotHost.md`、`canvas-render/07-settingsPanelTypes与settingsSource.md`。

> 🎨 **写颜色前先看 `../主题与配色.md`**：全仓配色走 `<html class="dark">` + CSS 变量，
> 不要给组件发明 `theme` 配置项。本插件的 `--canvas-node-*` 默认值与暗色覆盖也在那篇里说明。

## 一句话

它是 mini-canvas 的**默认画布皮**：装上它，画布就有默认的节点壳、连线样式、背景和一套可改外观的设置面板。
它对外是「主题槽的占用者」，对内又开着几套**扩展插槽**，让别的插件能往设置面板里塞东西 —— 本页重点是后半部分。

---

## 一、包定位 & 装上之后它做什么

- 包名 `@mini-canvas/plugin-theme-default`；插件导出 `name = 'theme-default'`、
  **`inject = []`（它不依赖任何服务）**、`Config`（可配置项 schema）、`apply(ctx, config)`。
  另有兼容出口 `themeDefaultPlugin: PluginModule`（即 `{ name, inject, Config, apply }`）。
- 装法：放进 `<CanvasHost :plugins="[...]"/>`，不用额外接 UI。成品清单见
  `packages/ui/src/assembly.ts` 的 `APP_PLUGINS`。

装上之后它做三件事：

1. **注册渲染皮** —— 用 `ctx.theme.register` 占住内核的 theme 槽（见 §二）。
2. **登记设计系统组件目录** —— 用 `ctx.registryOf('ui').add(...)` 登记按钮/下拉/滑块等通用件（见 §三）。
3. **申明可配置项 + 注册默认设置面板** —— `Config` 自动登记进 settings 单一数据源，
   再 `ctx.theme.register('settingsPanel', PluginSettingsDialog)` 把这些项展示成 UI，改动实时生效。

依赖方向：`theme-default → canvas-render（useCanvasRender 拿 ctx）→ canvas-data → kernel`，不反向。

> 历史注意：本插件**曾**声明 `inject: ['text']`（为了读 node-text 的类型），但全仓从不消费 `ctx.text`，
> 属提前写的死声明，且它造成 theme-default ⇄ node-text 的**包级循环依赖**。已删除，现在 `inject = []`。

---

## 二、它占用的主题槽（作为默认皮）

主题槽是**单赢家**槽（`winner(slot)` 取 `order` 最小者）。theme-default 用 `ctx.theme.register` 填默认值；
想换某一块皮肤，装一个 `order` 更小的插件占用同槽即顶替。

| 槽名 | theme-default 填的 | 作用 |
|---|---|---|
| `nodeShell` | `BaseNode.vue` | 节点外壳（端口 / 标题 / 选中环 / LOD / 浮动端口） |
| `edge` | `CustomEdge.vue` | 连线样式（流光 / 箭头 / 双击剪切） |
| `background` | `DefaultBackground.vue` | 画布点状背景 |
| `connectionLine` | `ConnectionLine.vue` | 拖线时的「待连预览线」 |
| `edgeDefaultType` | `'custom'` | 建边默认走 `custom` 边类型 |
| `settingsPanel` | `PluginSettingsDialog.vue`（id `default`，order 0） | 设置面板（默认赢家，被 `SettingsHost` 渲染） |

换皮示例：

```ts
// 换一套节点壳
ctx.theme.register('nodeShell', MyNode, { id: 'my', order: -1 })

// 换整个设置面板皮（新面板只需 defineProps<{ settings: SettingsPanelSource }>() 收 settings）
ctx.theme.register('settingsPanel', MyPanel, { order: -1 })
```

> ⚠️ `ctx.theme.register` 同槽重复会抛错（防误覆盖）；要叠加用 `ctx.theme.add`。
> 想把壳只换给某一种节点，用按 type 的槽：`ctx.theme.register(`nodeShell:${type}`, MyShell)`。
> 宿主装配壳的优先级是：**`registryOf('node/shell')` 场精确键 → 该场 `*` → theme 槽 `nodeShell:<type>` → theme 槽 `nodeShell`**
> （见 `canvas-render/src/host/canvasHostCore.ts` 的 `assembleTheme`）。所以"包一层但保留原壳"用场的 `wrap`。

---

## 三、它登记的设计系统组件目录（`registryOf('ui')`）

想让「换主题时业务插件一行不改」，通用件必须**按名取**而不是 import 主题包。
theme-default 把这几件登记进 `ui` 场（id `default`）：

| 名字 | 是什么 |
|---|---|
| `button` | `NodeToolbarButton` —— 节点上/下控制栏里的通用按钮 |
| `dropdown` | `Dropdown` —— 下拉浮层外壳 |
| `select` | `Select` —— 带搜索的下拉选择 |
| `slider` | `PrecisionSlider` —— 精细数值滑块 |
| `toolParamField` | `ToolParamField` —— 工具声明式参数控件 |

消费方按名取（见 `canvas-render/src/contracts/uiCatalog.ts`）：

```ts
import { useUiComponent } from '@mini-canvas/canvas-render'
const NodeToolbarButton = useUiComponent('button')   // 返回响应式 Ref；模板里自动解包
```

换一套主题时，新主题往同一个名字上叠一条 `order` 更小的即可，**业务插件零改动**。
仓库现状：`plugin-node-image` / `plugin-node-text` / `plugin-node-video` 已改为按名取，
不再 import theme-default（例外见 §六 坑 1）。

> 这几个组件本插件也**直接导出**（`export { Dropdown, Select, PrecisionSlider, ToolParamField, NodeToolbarButton }`），
> 供同包内或确需具体实现的场景使用；**新代码优先按名取**。
> 边界（设计文档决策 4）：目录只收「希望被主题整体换掉」的设计系统件；插件内部自用的小组件照旧 import。

---

## 四、它的可配置项（`Config`）与默认值常量

`Config`（`src/index.ts`）申明了一组**分组化**字段：连线、连线动效与箭头、端口、吸附带、节点标题、
低细节、多选标记、布局/控制栏、调试等。内核装配时经 schema 校验 + 补默认，并登记进 `settings` 单一数据源
（scope = `theme-default`）；改一项 → `settings.set(key, value)` → 画布外观就地窄更新，不整图重建。

本插件同时导出默认值与「哪些 key 影响哪种视觉」的映射常量，供宿主/其它插件参考：

| 常量 | 覆盖的视觉 |
|---|---|
| `DEFAULT_THEME_EDGE` + `EDGE_SETTING_KEYS` | 连线（色/宽/虚线/箭头/辉光/流光…） |
| `DEFAULT_THEME_HANDLE` + `HANDLE_SETTING_KEYS` | 浮动端口 |
| `DEFAULT_THEME_SNAP_ZONE` + `SNAP_ZONE_SETTING_KEYS` | 吸附带 |
| `DEFAULT_THEME_TITLE` + `TITLE_SETTING_KEYS` | 标题条 |
| `DEFAULT_THEME_MULTI_RADIO` | 多选标记 |
| `DEFAULT_THEME_LAYOUT` + `LAYOUT_SETTING_KEYS` | 布局 / 控制栏贴边距离 |
| `DEFAULT_THEME_PANEL` + `PANEL_SETTING_KEYS` | 生成控制栏尺寸 |
| `DEFAULT_THEME_DEBUG` + `DEBUG_SETTING_KEYS` | 调试可视化 |

> 用 manifest 给每个插件单独传 config 的写法见 `kernel/配置装配configSchema与ctx-settings.md`。

---

## 五、【重点】默认设置面板的扩展插槽

默认设置面板是 `PluginSettingsDialog.vue`（「居中 modal + 左一级导航 + 右内容」的皮）。
它**内部读内核通用 UI 槽**（`ctx.slots.occupants(...)`），于是别的插件不必换掉整个面板，就能：

- 往左侧**一级菜单**塞/替换项 —— 槽 `settingsNav`
- 往某一级下的**二级页签条**塞/替换项 —— 槽 `settingsTab`
- 接管某分组（或某二级叶子）的**右侧正文** —— 槽 `settingsGroup/<完整key>`

底层就是 `ctx.slots.register(slot, { id, order, component, meta })` 的多 occupant 槽，**随插件装卸自动回收**。

### 5.1 分组 key 的语义（为什么会有「一级 / 二级」）

字段 `group` 可用 `/` 表示**二级菜单**：如 `常规/显示` → 左导航一级 = `常规`，右页面签条 = 二级分组。

- 某一级下二级分组**多于一个**才显示页签条（tab）；只有一个则不显示页签，直接展示正文。
- **无 `/` 的扁平分组**（如 `连线`）即「一级 = 自己」，与旧版行为一致。
- 内容插槽 `settingsGroup/<key>` 里的 key 是**完整分组名**（扁平分组名，或带 `/` 的二级叶子全名）。

### 5.2 三套插槽一览

| 槽名 | 渲染位置 | occupant `id` 语义 |
|---|---|---|
| `settingsNav` | 左一级导航 | id = 一级名：命中 → 顶替那一级默认项；不命中 → 末尾追加一个自定义一级项 |
| `settingsTab` | 右二级页签条 | id 首段 = 当前一级名才生效：命中该级下某完整 key → 顶替那个二级页签；不命中 → 追加一个自定义二级页签 |
| `settingsGroup/<key>` | 右正文 | 接管某**完整 key** 的内容区；`meta.mode: 'replace'(缺省) / 'prepend' / 'append'` 控制是否与默认控件并存 |

> `settingsNav` / `settingsTab` 的 occupant 组件都收到 props：`{ group, active, onSelect }`，
> `onSelect(key)` 用于切换右侧到该 key。**不给它，点了就没反应。**

### 5.3 用法示例（在你的插件 `apply` 里）

```ts
// ① 一级菜单：id 命中一级名「外观」→ 顶替那个一级默认项（组件自绘整条导航）
ctx.slots.register('settingsNav', { id: '外观', order: 1, component: MyNavItem })

// ② 二级页签：config 里把「外观」拆成 外观/圆角 + 外观/阴影 → 「外观」下才出现页签条；
//    这里顶替「外观/圆角」那个页签
ctx.slots.register('settingsTab', { id: '外观/圆角', order: 0, component: MyTabItem })

// ③ 正文：接管「外观/阴影」的内容区，让自定义预览与默认 schema 控件并存
ctx.slots.register('settingsGroup/外观/阴影', {
  id: 'my-shadow-preview',
  order: 0,
  component: MyPreviewPanel,
  meta: { mode: 'append' },   // replace(缺省)=整组接管；prepend/append=与默认控件并存
})
```

配套占位组件收的 props：

```ts
// 导航 / 页签占位：整条由你自绘，点它调注入的 onSelect 切右侧
defineProps<{ group?: string; active?: boolean; onSelect?: (g: string) => void }>()
```

```ts
// 内容占位（接管某 key 正文）：收 { group, settings }
defineProps<{ group?: string; settings?: SettingsPanelSource }>()
// settings 非响应式 → 用 settings.onChange(() => tick++) 驱动本地重渲染再取值
// 若只想渲染某一个标准字段控件，用 injectSettingsFieldRenderer()（见 canvas-render/05）
```

要点：

- **`meta.mode` 只对 `settingsGroup/<key>` 生效**：`prepend`/`append` 与默认 schema 控件并存；
  缺省 `replace` 整块接管、隐藏默认控件。
- **二级页签只在「当前一级下二级分组多于一个」时出现**，所以 `settingsTab` 只在该场景有机会渲染。
- **跨一级隔离**：`settingsTab` 按「id 首段 === 当前一级名」过滤，不会串到别的一级里。

### 5.4 想换整张设置面板皮？

扩展插槽属于**默认皮实现**（`PluginSettingsDialog`），不是 `settingsPanel` 槽的契约。
换了皮就没有这些槽了 —— 所以**优先在默认皮上加东西，而不是换掉整张皮**。

---

## 六、最小可运行示例

```ts
import { CanvasHost } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

// 画布通用命令（建/删/撤销/重做）由数据层自带、宿主 boot 时默认注册，不必列进 plugins
const plugins = [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin]
```

顶部放一个 `<SettingsHost/>`（用 `v-if` 控制显隐）即可弹出设置。完整样板见
`packages/ui/src/App.vue`（顶部「⚙ 设置」按钮 + `<SettingsHost/>`）与 `canvas-render/06`。

---

## 七、坑

1. **`plugin-multi-select` 仍直接 import `MovingHandle` / `ConnectionLine`** —— 这是有意的：
   它们是**交互件**（浮层里的临时端口、拖线预览线），不是设计系统件，按决策 4 的边界**不进 `ui` 目录**。
2. **只在 `<CanvasHost>` 子树 / `#ui` 区**用依赖 `useCanvasRender` 的面板与浮层；放外面会抛错。
3. **别用 `:key` 重挂设置面板**（输入框每按键丢焦点）；要自刷新靠 `settings.onChange` 订阅。
4. **`settingsNav` / `settingsTab` 的 occupant 记得给 `onSelect`**，否则点击无反应（最容易踩）。
5. 默认设置面板的 CSS 前缀是 `psd-`（`psd-nav` / `psd-tabs` / `psd-content`…）。
6. 端口默认值存在**双源漂移**（宿主回落 `portZoneWidth = 86` vs 本插件 Config 默认 `10`），
   动端口几何前先对齐这两处（见 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` §9）。

