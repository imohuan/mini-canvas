# 默认主题组件库：装了默认皮，你就有一整套现成组件

**一句话**：默认主题插件（theme-default）不只画节点和连线，它还把一整套通用界面件
（按钮、下拉、气泡、滑块、取色器、参数控件、端口、临时连线……）**注册到画布上**，
任何插件都能**按名字取来直接用**，不必自己写、也不该自己复制一份。

本页回答三件事：**注册了哪些**、**为什么算"全局可用"**、**每件怎么用**（每件一篇，见页面末尾目录）。

## 一、它注册了两类东西

| 类别 | 落在哪 | 是什么 | 能不能被换掉 |
| --- | --- | --- | --- |
| **渲染皮**（6 条） | 主题槽 `ctx.theme` | 节点壳 / 连线 / 背景 / 拖线临时线 / 默认边类型 / 设置面板 | 能。装一个 order 更小的插件占同一槽即顶替 |
| **设计系统组件目录**（14 条） | 注册场 `ctx.registryOf('ui')` | 按钮 / 下拉 / 气泡 / 选择器 / 全屏预览 / 滑块 / 参数控件族 / 取色器 / 浮动端口 / 临时连线 | 能。同一个名字上叠一条 order 更小的即顶替 |

## 二、渲染皮（主题槽）—— 画布"长什么样"由它们决定

来源：`packages/plugins/plugin-theme-default/src/index.ts` 的 `apply(ctx)`。

| 槽名 | 放进去的组件 | 它管什么 | 详情 |
| --- | --- | --- | --- |
| `nodeShell` | `BaseNode` | 每个节点的外壳：端口、标题、选中环、低细节、浮动端口 | [节点壳 BaseNode](/plugins/theme-components/base-node) |
| `edge` | `CustomEdge` | 连线的完整外观：流光、箭头、双击剪切 | [连线 CustomEdge](/plugins/theme-components/custom-edge) |
| `background` | `DefaultBackground` | 画布底：跟随平移缩放的点状网格 | [画布背景 DefaultBackground](/plugins/theme-components/default-background) |
| `connectionLine` | `ConnectionLine` | 拖线时那根"待连预览线" | [拖线临时线 ConnectionLine](/plugins/theme-components/connection-line) |
| `edgeDefaultType` | 字符串值 `'custom'` | 新建边的默认类型走 `custom` | 见下方"注意事项"第 5 条 |
| `settingsPanel` | `PluginSettingsContent` | 设置界面的**中间层**（左导航 + 内容区）；最外层窗口由渲染层 `SettingsShell` 提供 | [设置面板 PluginSettingsContent](/plugins/theme-components/plugin-settings-content) |

这六条都是**单赢家槽**：同一槽名上 `order` 最小者赢（`order` 越小越靠外）。
想换其中一块，注册一个 `order` 更小的插件即可；默认件不会被删，只是排到后面。

## 三、设计系统组件目录（`ui` 场）—— 一共 14 个名字

来源同上：`apply` 里逐条 `ui.add(名字, 组件, { id: 'default' })`。

| 目录名（按名取用就传这个字符串） | 组件 | 一句话 | 详情 |
| --- | --- | --- | --- |
| `button` | `NodeToolbarButton` | 节点上/下控制栏里的通用按钮 | [按钮](/plugins/theme-components/node-toolbar-button) |
| `dropdown` | `Dropdown` | 下拉浮层外壳（只管浮层，不管选项逻辑） | [下拉浮层](/plugins/theme-components/dropdown) |
| `tooltip` | `Tooltip` | 悬浮气泡提示 | [气泡提示](/plugins/theme-components/tooltip) |
| `select` | `Select` | 带搜索的下拉选择器 | [下拉选择器](/plugins/theme-components/select) |
| `mediaViewer` | `MediaViewer` | 全屏媒体查看器（文本/图片/视频/音频） | [全屏媒体预览](/plugins/theme-components/media-viewer) |
| `slider` | `PrecisionSlider` | 精细数值滑块（Ctrl 细调 / Shift 粗调） | [精细滑块](/plugins/theme-components/precision-slider) |
| `toolParamField` | `ToolParamField` | 工具声明式参数控件（按 `kind` 自动选预设件） | [参数控件](/plugins/theme-components/tool-param-field) |
| `toolParamGroup` | `ToolParamGroup` | 把多个参数收敛成一个下拉（「16:9 · 2K · 1张 ⌄」） | [参数组](/plugins/theme-components/tool-param-group) |
| `toolParamGrid` | `ToolOptionGrid` | 参数预设：小标题 + 按钮网格 | [选项网格](/plugins/theme-components/tool-option-grid) |
| `toolParamRatio` | `ToolRatioGrid` | 参数预设：按真实宽高比画小矩形的比例网格 | [比例网格](/plugins/theme-components/tool-ratio-grid) |
| `toolParamSlider` | `ToolParamSlider` | 参数预设：滑块 + 当前值 + 单位 | [参数滑块](/plugins/theme-components/tool-param-slider) |
| `color` | `ColorField` | 取色器（色板 + 透明度） | [取色器](/plugins/theme-components/color-field) |
| `movingHandle` | `MovingHandle` | 节点浮动端口（拖拽时看到的小圆球） | [浮动端口](/plugins/theme-components/moving-handle) |
| `connectionLine` | `ConnectionLine` | 拖线临时线（与 `theme.connectionLine` 是同一个组件） | [拖线临时线](/plugins/theme-components/connection-line) |

> 名字只是字符串，**不是封闭枚举**：主题可以登记自定名字，插件也可以往目录里加自己的件。
> `UI_NAMES`（在 `@mini-canvas/canvas-render`）里列的是"约定俗成的常用名"，不必背。

## 四、在画布里直接看它们跑起来

上面是清单，下面这种才是最直观的：**组件展厅**插件（`theme-gallery`，**可装卸件** ——
到「设置 → 插件 → 本地清单」点安装，默认不自动装）。
装上之后画布左下角有一个"组件展厅"按钮，点开是一个浮层 —— 里面把本节列出的组件
**真的渲染出来**：点得动、拉得开、能输文字，和插件按名取到的是同一份实现。

<ComponentPreview name="ThemeKitProbe" />

> 展厅插件源码：`packages/plugins/plugin-theme-gallery/`。它自己也是用
> `useUiComponent` 按名取件 —— 所以展厅看到什么，就等于插件拿到什么。

## 五、为什么叫"全局可用"

因为登记的落点是**注册场**，注册场住在画布的 `ctx` 上；`ctx` 全局唯一，
所以"谁登记的"和"谁取用的"不需要互相认识。这就是"全局可用"的确切含义。

取用有三条路，按你在哪来选：

| 你在哪 | 用哪个函数 | 返回什么 | 什么时候用 |
| --- | --- | --- | --- |
| 画布渲染子树内的组件 | `useUiComponent('名字')` | 响应式 `Ref` | **首选**。换主题时当场跟着换，组件不必重挂 |
| 非组件代码（工具函数 / 插件 `apply` 里） | `uiComponent(ctx, '名字')` | 组件句柄或 `undefined` | 拿一次就用（非响应式） |
| 画布树**外**（Teleport 到 body 的浮层、资产抽屉） | `uiComponentOutside('名字')` | 组件句柄或 `undefined` | 树外取不到 provide，只能走这条一次性通道 |

三条都从 `@mini-canvas/canvas-render` 导入：

```vue
<!-- 文件：packages/my-plugin/src/components/MyPanel.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件包里的一个面板组件 —— 它要用默认主题的按钮 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

// ① 按名取，拿到的是 Ref；模板里直接写 <NodeToolbarButton ... /> 即可（Vue 自动解包）
const NodeToolbarButton = useUiComponent('button')

function refresh() { /* ... */ }
</script>

<template>
  <NodeToolbarButton title="刷新" @click="refresh" />
</template>
```

## 六、它同时也走"具名导出"

这些组件还有第二种拿法：直接从包上 import。

```ts
// 文件：packages/my-plugin/src/SomePanel.vue
// 格式：Vue 单文件组件
// 位置：插件包里的面板 —— 它明确就要默认主题的这一份具体实现
import { Dropdown, Select, PrecisionSlider, ToolParamField, NodeToolbarButton, ColorField, MediaViewer } from '@mini-canvas/plugin-theme-default'
// 渲染件也导出了
import { MovingHandle, ConnectionLine, CustomEdge } from '@mini-canvas/plugin-theme-default'
```

**两种拿法怎么选**：想"换主题时它一起换" → **按名取**；只是同包内自己用、
或者明确就要这一份具体实现 → **具名 import**。

## 七、这套目录的边界

- **只收"希望被主题整体换掉"的设计系统件**。插件内部自用的小组件（只在本插件里出现的角标、
  专用图标）照旧自己写、自己 import，不要往目录里塞 —— 全面目录化 = 字符串驱动，
  打错字运行时才炸，还丢类型提示。
- **端口与临时连线是有意放进来的**：多选插件要画同款端口、同款临时线，但它**不该依赖主题包**
  （依赖方向 `kernel ← canvas-data ← canvas-render ← plugins`，插件之间不互相 import 实现）。
  按名取是唯一正确的通道。

## 八、注意事项

1. **取不到不抛错，但会静默不显示**：`useUiComponent` 找不到名字时返回 `undefined`
   并 `console.warn`；`uiComponent` / `uiComponentOutside` 只返回 `undefined`。
   表现为"组件没渲染"，**先查名字拼写**。
2. **`useUiComponent` 必须在画布渲染子树内调用**（它内部走 `useCanvasRender()` 拿 ctx）。
   在画布外调用会抛错 —— 树外请用 `uiComponentOutside`。
3. **"默认主题装了才有"**：这 14 个名字是 theme-default 登记的。只装业务插件、不装主题插件，目录就是空的。
   成品应用一定装了它（`packages/ui/src/assembly.ts` 的 `APP_PLUGINS` 第一条）。
4. **成品应用会顶替其中两个名字**：`packages/ui` 里有两个应用层插件用 `order: -1` 注册了
   `dropdown`（`AxDropdown`）与 `settingsPanel`（`AppSettingsPanel`），
   所以按名取到的是成品应用那一份。**这不是冲突，是设计**：目录的用途正是"让顶层替换掉底层实现"。
5. **`edgeDefaultType` 存的是字符串不是组件**：它是"默认边类型"这个取值
   （`ctx.theme.register('edgeDefaultType', 'custom')`），不是渲染件。

## 九、全部组件文档

渲染皮：

- [节点壳 BaseNode](/plugins/theme-components/base-node)
- [连线 CustomEdge](/plugins/theme-components/custom-edge)
- [画布背景 DefaultBackground](/plugins/theme-components/default-background)
- [拖线临时线 ConnectionLine](/plugins/theme-components/connection-line)
- [设置面板 PluginSettingsContent](/plugins/theme-components/plugin-settings-content)

设计系统组件：

- [按钮 NodeToolbarButton](/plugins/theme-components/node-toolbar-button)
- [下拉浮层 Dropdown](/plugins/theme-components/dropdown)
- [气泡提示 Tooltip](/plugins/theme-components/tooltip)
- [下拉选择器 Select](/plugins/theme-components/select)
- [全屏媒体预览 MediaViewer](/plugins/theme-components/media-viewer)
- [精细滑块 PrecisionSlider](/plugins/theme-components/precision-slider)
- [参数控件 ToolParamField](/plugins/theme-components/tool-param-field)
- [参数组 ToolParamGroup](/plugins/theme-components/tool-param-group)
- [选项网格 ToolOptionGrid](/plugins/theme-components/tool-option-grid)
- [比例网格 ToolRatioGrid](/plugins/theme-components/tool-ratio-grid)
- [参数滑块 ToolParamSlider](/plugins/theme-components/tool-param-slider)
- [取色器 ColorField](/plugins/theme-components/color-field)
- [浮动端口 MovingHandle](/plugins/theme-components/moving-handle)

## 相关

- 默认主题插件本身（配置项、设置面板扩展插槽、怎么换皮）：[默认主题 theme-default](/plugins/theme-default)
- 注册场规则：`order` 谁小谁赢、单赢家槽怎么取 → [注册场](/intro/registries)
- 源码：`packages/canvas-render/src/contracts/uiCatalog.ts`（按名取的实现）、
  `packages/plugins/plugin-theme-default/src/index.ts`（登记处）
