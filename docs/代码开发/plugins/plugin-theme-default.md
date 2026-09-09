# plugin-theme-default —— 默认主题/默认"皮"插件用法（重点：它的插槽）

> 来源：`packages/plugins/plugin-theme-default/src/index.ts`（插件主文件）、
> `src/components/settings/PluginSettingsDialog.vue`（默认设置面板 = 扩展插槽的宿主）
> 相关底层：`canvas-core-v2/主题换肤ctx-theme与ThemeRegistry.md`、`canvas-core-v2/通用UI槽ctx-slots与命令ctx-commands.md`、
> `canvas-render/06-SettingsHost与SlotHost.md`、`canvas-render/07-settingsPanelTypes与settingsSource.md`

## 一句话

它是 mini-canvas 的**"默认画布皮"**插件：装了它，你的画布就有默认的节点壳、连线样式、背景和一套
**可改外观的设置面板**。它对外既是"皮肤（theme 槽的占用者）"，内部又开着几套**扩展插槽**，
让别的插件能往设置面板里塞东西。**本页重点是后半部分——它的插槽怎么用。**

---

## 一、包定位 & 它给你什么

- 包名 `@mini-canvas/plugin-theme-default`；插件导出 `name='theme-default'`、
  `inject=['text']`（它依赖 text 节点提供的服务）、`Config`（可配置项 schema）、`apply(ctx, config)`。
- 在 CanvasHost 的 `:plugins` 里装上它即可，不用额外接 UI。宿主常用的成套插件清单见
  `packages/ui/src/App.vue`。

装上之后它做两件事：

1. **注册渲染皮**（用 `ctx.theme.register` 占住内核的 theme 槽，见下表 → §二）。
2. **申明一堆可配置项**（`Config`）自动登记进 settings 单一数据源，再注册一个默认设置面板
   （`ctx.theme.register('settingsPanel', PluginSettingsDialog)`）把这些项展示成 UI，改动实时生效。

依赖方向：**theme-default → canvas-render（useCanvasRender 拿 ctx）→ canvas-core-v2**，不反向。

---

## 二、它占用的"主题槽"（ThemeSlot，作为默认皮）

主题槽是内核的单赢家槽（`winner(slot)` 取 order 最小者）。theme-default 用 `ctx.theme.register` 填了
默认值；想换某一块皮肤，装一个 order 更小的插件占用同槽即顶替。

| 槽名 | theme-default 默认填 | 作用 |
|---|---|---|
| `nodeShell` | `BaseNode.vue` | 节点外壳（端口/标题/选中环/LOD/浮动端口） |
| `edge` | `CustomEdge.vue` | 连线样式（流光/箭头/双击剪切） |
| `background` | `DefaultBackground.vue` | 画布点状背景 |
| `connectionLine` | `ConnectionLine.vue` | 拖线时的"待连预览线" |
| `edgeDefaultType` | `'custom'` | 建边默认走 `custom` 边类型 |
| `settingsPanel` | `PluginSettingsDialog.vue` | 设置面板（默认赢家，被 SettingsHost 渲染） |

> 换皮示例：想换一套节点壳，写个插件 `ctx.theme.register('nodeShell', MyNode, { id:'my', order:-1 })`。
> 想整体换设置面板皮：`ctx.theme.register('settingsPanel', MyPanel, { order:-1 })`，新面板只需
> `defineProps<{ settings: SettingsPanelSource }>()` 收 `settings` 即可（SettingsHost 喂给它）。见
> `canvas-render/06`、`07`。

---

## 三、它的可配置项（`Config`）与默认皮来源

`Config`（`src/index.ts`）申明了一组分组化的字段：连线（edgeType/edgeColor/线宽/箭头…）、连线动效与箭头、
端口、吸附带、调试等。内核装配时经 schema 校验 + 补默认，并自动登记进 `settings` 单一数据源
（scope=theme-default）；改一项 → `settings.set(key, value)` → 画布外观就地窄更新，不整图重建。

theme-default 顺带导出了默认值与"哪些 key 影响哪种视觉"的映射常量，供宿主/其它插件参考：
`DEFAULT_THEME_EDGE`、`DEFAULT_THEME_HANDLE`、`DEFAULT_THEME_DEBUG`、`DEFAULT_THEME_SNAP_ZONE`
以及 `EDGE_SETTING_KEYS`、`HANDLE_SETTING_KEYS`、`DEBUG_SETTING_KEYS`、`SNAP_ZONE_SETTING_KEYS`
（这些 key 分别对应 edge/handle/debug/snapZone 四组视觉）。

> Config 覆盖默认值的写法见内核装配文档（`canvas-core-v2/配置装配configSchema与ctx-settings.md`）——
> 通常用 manifest 给每个插件单独传 `config`。

---

## 四、【重点】默认设置面板的扩展插槽

theme-default 的默认设置面板是 `PluginSettingsDialog.vue`（"居中 modal + 左一级导航 + 右内容"的皮）。
它**内部读内核通用 UI 槽**（`ctx.slots.occupants(...)`），于是插件不必换掉整个面板，就能：
- 往左侧**一级菜单**塞/替换项 —— 槽 `settingsNav`
- 往某一级下的**二级页签条**塞/替换项 —— 槽 `settingsTab`
- 接管某分组（或某二级叶子）的**右侧正文** —— 槽 `settingsGroup/<完整key>`

这套机制底层是 `ctx.slots.register(slot, { id, order, component, meta })` 的多 occupant 槽，
随插件装卸自动回收（写 `apply` 即可，卸载自动清）。

### 4.0 分组 key 的语义（为什么会有"一级 / 二级"）

字段 `group` 可用 `/` 表示**二级菜单**：如 `常规/显示` → 左导航一级=`常规`，右页面签条=二级分组。
- 某一级下二级分组**多于一个**才显示页签条(tab)；只有一个则不显示页签、直接展示正文。
- **无 `/` 的扁平分组**（如 `图片`、`连线`）即"一级=自己"，行为和旧版一致。
- 内容插槽 `settingsGroup/<key>` 里的 key 是**完整分组名**（扁平分组名或带 `/` 的二级叶子全名），
  `settings.groupOf(key)` 也用完整 key。

### 4.1 三套插槽一览

| 槽名 | 渲染位置 | occupant `id` 语义 |
|---|---|---|
| `settingsNav` | 左一级导航 | id = 一级名：命中 → 顶替那一级默认项；不命中（且不以 `#` 开头）→ 末尾追加一个自定义一级项 |
| `settingsTab` | 右二级页签条 | id 首段 = 当前一级名才生效：命中该级下某完整分组 key → 顶替那个二级页签；不命中 → 追加一个自定义二级页签 |
| `settingsGroup/<key>` | 右正文 | 接管某**完整 key** 的内容区；`meta.mode: 'replace'(缺省) / 'prepend' / 'append'` 控制是否与默认控件并存 |

> `settingsNav` / `settingsTab` 的 occupant 组件都会收到 props：
> `{ group, active, onSelect }`，其中 `onSelect(key)` 用于切换右侧到该 key。**不给它点了就没反应**。

### 4.2 用法示例（在你的插件 apply 里）

三套槽都经 `ctx.slots.register(slot, { id, order, component, meta })` 填充，装卸自动回收。

```ts
// ① 一级菜单：id 命中一级名「外观」→ 顶替那个一级默认项（占位组件自绘整条导航）
ctx.slots.register('settingsNav', { id: '外观', order: 1, component: MyNavItem })

// ② 二级页签：config 里把「外观」拆成 外观/圆角 + 外观/阴影 两个二级分组 → 「外观」下出现页签条；
//    这里顶替「外观/圆角」那个二级页签（占位组件自绘该页签）
ctx.slots.register('settingsTab', { id: '外观/圆角', order: 0, component: MyTabItem })

// ③ 正文：接管「外观/阴影」的内容区，并让自定义预览与默认 schema 控件并存（meta.mode='append'）
ctx.slots.register('settingsGroup/外观/阴影', {
  id: 'my-shadow-preview',
  order: 0,
  component: MyPreviewPanel,   // 一块"改配置实时看效果"的预览UI
  meta: { mode: 'replace' },   // replace(缺省)=整组接管、隐藏默认控件；prepend/append=与默认控件并存
})
```

配套占位组件收的 props：

```ts
// 导航/页签占位：整条由你自绘，点它调注入的 onSelect 切右侧
defineProps<{ group?: string; active?: boolean; onSelect?: (g: string) => void }>()
```

```ts
// 内容占位（接管某 key 正文）：收 { group, settings }，可自绘并读 settings 改值
defineProps<{ group?: string; settings?: SettingsPanelSource }>()
// settings 非响应式 → 用 settings.onChange(() => tick++) 驱动本地重渲染再取值
//（SettingsSchemaField / node-image 的 DemoSlotContent 都是这么做的）
```

关键几点：
- **meta.mode 并存语义**：只对 `settingsGroup/<key>` 生效——`prepend`/`append` 让它和该 key 的默认
  schema 控件并存；缺省 `replace` 则整块接管、隐藏默认控件（向后兼容）。
- **二级页签只有在"当前一级下二级分组多于一个"时才出现**，所以 `settingsTab` 只在该场景有机会渲染；
  一个一级只有一个二级分组时不会显示页签，插槽也不会有渲染机会。
- **跨一级隔离**：`settingsTab` 按 "id 首段 === 当前一级名" 过滤，避免你在别的插件里注册的页签跑到
  当前一级里来。

### 4.3 想在别的宿主换默认皮但要保留扩展槽？

默认皮 `PluginSettingsDialog` 是**推荐保留**的（它实现了上述扩展槽）。若你非要自己写设置面板皮，
扩展槽能力属于默认皮实现，不是 `settingsPanel` 槽契约——新皮想用槽要自己用 `useCanvasRender()` 读
`ctx.slots`。因此**优先在默认皮上加东西，而不是换掉整张皮**。

---

## 五、最小可运行示例（放到 CanvasHost 的 plugins 里）

```ts
import { CanvasHost } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'   // 若你想看 node 类外观设置的分组
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'

const plugins = [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]
// 顶部放一个 <SettingsHost/>（v-if 控制显隐）即可弹出设置
```

> 想在你的 Vue App 里把"设置"接到 UI：见 `packages/ui/src/App.vue`（顶部"⚙ 设置"按钮 +
> `<SettingsHost/>`），以及 `canvas-render/06` 的 SettingsHost 说明。

---

## 六、坑

1. **只在 CanvasHost 子树 / `#ui` 区用**依赖 `useCanvasRender` 的面板与浮层；放外面会抛错。
2. **别用 `:key` 重挂设置面板**（输入框每按键丢焦点）；要自刷新靠 `settings.onChange` 订阅。
3. **settingsNav / settingsTab 的 occupant 记得给 `onSelect`**，否则点击无反应（用户最容易踩）。
4. **默认设置面板的 5 条 CSS 前缀是 `psd-`**（psd-nav / psd-tabs / psd-content…），DIY 皮肤可参考。
