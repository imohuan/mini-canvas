# 默认主题组件库：装了默认皮，你就有一整套现成组件

**一句话**：默认主题的通用组件半边（theme-components）不只画节点和连线，它还把一整套通用界面件
（按钮、下拉、气泡、滑块、取色器、参数控件、端口、临时连线……）**注册到画布上**，
任何插件都能**按名字取来直接用**，不必自己写、也不该自己复制一份。

本页回答三件事：**注册了哪些**、**为什么算"全局可用"**、**每件怎么用**（每件一篇，见页面末尾目录）。

## 一、先分清两个包

默认主题拆成了两个独立插件包，互不 import：

| 包 | 插件 | 管什么 |
| --- | --- | --- |
| `@mini-canvas/plugin-theme-components` | `theme-components` | 本页讲的通用组件、设置面板、外观变量、通知服务（应用级常驻） |
| `@mini-canvas/plugin-theme-canvas` | `theme-canvas` | 节点壳 / 连线 / 背景 / 节点工具栏（进画布才启动），见 [默认主题](/plugins/theme-canvas) |

两者共享的纯数据在 `@mini-canvas/theme-contract`。

## 二、它注册了两类东西

| 类别 | 落在哪 | 是什么 | 能不能被换掉 |
| --- | --- | --- | --- |
| **渲染皮**（本包 1 条） | 主题槽 `ctx.theme` | 设置面板 `settingsPanel`；节点壳 / 连线 / 背景 / 拖线临时线由 theme-canvas 注册 | 能。装一个 order 更小的插件占同一槽即顶替 |
| **设计系统组件目录** | 注册场 `ctx.registryOf('ui')` | 工具栏件 / 全屏预览 / 滑块 / 参数控件族 / 取色器 / 浮动端口 / 临时连线，以及全部 shadcn 原始组件 | 能。同一个名字上叠一条 order 更小的即顶替 |

## 三、渲染皮（主题槽）—— 本包只占设置面板

来源：`packages/plugins/plugin-theme-components/src/index.ts` 的 `apply(ctx)`。

| 槽名 | 放进去的组件 | 它管什么 | 详情 |
| --- | --- | --- | --- |
| `settingsPanel` | `PluginSettingsContent` | 设置界面的**中间层**（左导航 + 内容区）；最外层窗口由渲染层 `SettingsShell` 提供 | [设置面板 PluginSettingsContent](/plugins/theme-components/plugin-settings-content) |

节点壳 / 连线 / 背景 / 拖线临时线 / 默认边类型这五条由 [theme-canvas](/plugins/theme-canvas) 注册。

所有主题槽都是**单赢家槽**：同一槽名上 `order` 最小者赢（`order` 越小越靠外）。
想换其中一块，注册一个 `order` 更小的插件即可；默认件不会被删，只是排到后面。

## 三、设计系统组件目录（`ui` 场）

来源同上：`apply` 里逐条 `ui.add(名字, 组件, { id: 'default' })`。

| 目录名（按名取用就传这个字符串） | 组件 | 一句话 | 详情 |
| --- | --- | --- | --- |
| `mediaViewer` | `MediaViewer` | 全屏媒体查看器（文本/图片/视频/音频） | [全屏媒体预览](/plugins/theme-components/media-viewer) |
| `slider` | `PrecisionSlider` | 精细数值滑块（Ctrl 细调 / Shift 粗调） | [精细滑块](/plugins/theme-components/precision-slider) |
| `toolParamField` | `ToolParamField` | 工具声明式参数控件（按 `kind` 自动选预设件） | [参数控件](/plugins/theme-components/tool-param-field) |
| `toolParamGroup` | `ToolParamGroup` | 把多个参数收敛成一个下拉（「16:9 · 2K · 1张 ⌄」） | [参数组](/plugins/theme-components/tool-param-group) |
| `toolParamGrid` | `ToolOptionGrid` | 参数预设：小标题 + 按钮网格 | [选项网格](/plugins/theme-components/tool-option-grid) |
| `toolParamRatio` | `ToolRatioGrid` | 参数预设：按真实宽高比画小矩形的比例网格 | [比例网格](/plugins/theme-components/tool-ratio-grid) |
| `toolParamSlider` | `ToolParamSlider` | 参数预设：滑块 + 当前值 + 单位 | [参数滑块](/plugins/theme-components/tool-param-slider) |
| `color` | `ColorField` | 取色器（色板 + 透明度） | [取色器](/plugins/theme-components/color-field) |
| `movingHandle` | `MovingHandle` | 节点浮动端口（拖拽时看到的小圆球）—— **由 theme-canvas 登记** | [浮动端口](/plugins/theme-components/moving-handle) |
| `connectionLine` | `ConnectionLine` | 拖线临时线（与 `theme.connectionLine` 是同一个组件）—— **由 theme-canvas 登记** | [拖线临时线](/plugins/theme-components/connection-line) |
| `nodeModeTopBar` / `nodeModeBottomBar` | `NodeModeTopBar` / `NodeModeBottomBar` | 节点上下模式工具栏 —— **由 theme-canvas 登记** | [节点工具栏](/examples/node-toolbar) |

> 通用按钮、下拉、选择器、气泡也在这张目录里：默认主题把 shadcn 原始组件按**导出名**登记，
> 业务插件写 `const Button = useUiComponent('Button')` 或
> `const { DropdownMenu, DropdownMenuContent } = useUiComponent()` 取件。
> 只有默认主题插件可以直接 import `@mini-canvas/ui-kit-shadcn`，其它地方都走注册表。
>
> 名字只是字符串，**不是封闭枚举**：主题可以登记自定名字，插件也可以往目录里加自己的件。
> `UI_NAMES`（在 `@mini-canvas/canvas-render`）里列的是"约定俗成的常用名"，不必背。

## 四、在画布里直接看它们跑起来

上面是清单，下面这种才是最直观的：**组件展厅**（住在 `demo-kit` 里，**可装卸件** ——
到「设置 → 插件 → 本地清单」装一次 `demo-kit`，默认不自动装）。
装上之后画布左下角有一个"组件展厅"按钮，点开是一个浮层 —— 里面把本节列出的组件
**真的渲染出来**：点得动、拉得开、能输文字，和插件按名取到的是同一份实现。

<ComponentPreview name="ThemeKitProbe" />

> 展厅源码：`packages/plugins/plugin-demo-kit/src/gallery/`。它自己也是用
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
<!-- 位置：插件包里的一个面板组件 —— 它要用默认主题的精细滑块 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

// ① 按名取，拿到的是 Ref；模板里直接写 <PrecisionSlider ... /> 即可（Vue 自动解包）
const PrecisionSlider = useUiComponent('slider')

function refresh() { /* ... */ }
</script>

<template>
  <PrecisionSlider :model-value="48" :min="0" :max="100" @update:model-value="refresh" />
</template>
```

## 六、它同时也走"具名导出"

这些组件还有第二种拿法：直接从包上 import。

```ts
// 文件：packages/my-plugin/src/SomePanel.vue
// 格式：Vue 单文件组件
// 位置：插件包里的面板 —— 它明确就要默认主题的这一份具体实现
import { PrecisionSlider, ToolParamField, ColorField, MediaViewer } from '@mini-canvas/plugin-theme-components'
// 渲染件在画布那一半
import { MovingHandle, ConnectionLine, CustomEdge } from '@mini-canvas/plugin-theme-canvas'
```

**两种拿法怎么选**：想"换主题时它一起换" → **按名取**；只是同包内自己用、
或者明确就要这一份具体实现 → **具名 import**。

## 七、这套目录的边界

### 还没换成组件库的地方（有意保留）

下面几处仍是原生元素，不是漏改 —— 换成 Button / Input 反而会破坏行为：

| 位置 | 为什么保留原生元素 |
| --- | --- |
| 画布列表行（`ProjectCluster.vue` 的 `.canvas-row-main`） | 整行是点击目标，行内还有重命名输入框与行尾菜单；套 Button 会出现按钮里嵌按钮 |
| 左侧抽屉的画布树行（`LeftDrawer.vue`） | 同一行同时承担展开、重命名、拖拽三种交互，按钮语义不成立 |
| 节点底栏的模型 / 参数摘要行（`NodeBottomBar.vue`） | 它显示的是当前选择的只读摘要，真正的控件是旁边的下拉与滑块 |
| 上传用的隐藏 `<input type="file">` | 浏览器原生文件选择器，视觉入口是旁边的按钮，input 本身不可见 |

这些位置的字号、颜色、圆角仍走项目 token（`--ui-*` / `--radius-*`），改主题时照样跟着变。

- **只收"希望被主题整体换掉"的设计系统件**。插件内部自用的小组件（只在本插件里出现的角标、
  专用图标）照旧自己写、自己 import，不要往目录里塞 —— 全面目录化 = 字符串驱动，
  打错字运行时才炸，还丢类型提示。
- **端口与临时连线是有意放进来的**：多选插件要画同款端口、同款临时线，但它**不该依赖主题包**
  （依赖方向 `kernel ← canvas-data ← canvas-render ← plugins`，插件之间不互相 import 实现）。
  按名取是唯一正确的通道。

## 八、注意事项

0. **看某个组件到底在哪被用**：设置里打开「常规 → 调试 → 组件库使用标记」，每个 shadcn 组件右上角会出现
   一个小圆点，悬停显示使用文件与行号。模板里直写的使用点由 Vite 开发插件注入；
   插件按名取到的（`<component :is="...">`）由默认主题登记时包一层透明标记（`withUiKitDebugMark`，
   props / slots / 事件完全透传）。生产构建不注入、不挂载调试层。
1. **取不到不抛错，但会静默不显示**：`useUiComponent` 找不到名字时返回 `undefined`
   并 `console.warn`；`uiComponent` / `uiComponentOutside` 只返回 `undefined`。
   表现为"组件没渲染"，**先查名字拼写**。
2. **`useUiComponent` 必须在画布渲染子树内调用**（它内部走 `useCanvasRender()` 拿 ctx）。
   在画布外调用会抛错 —— 树外请用 `uiComponentOutside`。
3. **"默认主题装了才有"**：通用件由 theme-components 登记，端口 / 临时线 / 节点工具栏由 theme-canvas 登记。
   只装业务插件、不装主题插件，目录就是空的。成品应用一定两件都装了
   （`packages/ui/src/assembly.ts` 的 `APP_PLUGIN_REGISTRY`）。
4. **设置面板只有一份**：`settingsPanel` 由本主题包注册（`PluginSettingsContent`），
   成品应用那套界面已并入本包（2026-11-04），`packages/ui` 不再注册换皮插件。
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

- [下拉菜单 DropdownMenu](/plugins/theme-components/dropdown)
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

- 画布外观那一半（节点壳 / 连线 / 背景 / 怎么换皮）：[默认主题 theme-canvas](/plugins/theme-canvas)
- 注册场规则：`order` 谁小谁赢、单赢家槽怎么取 → [注册场](/intro/registries)
- 源码：`packages/canvas-render/src/contracts/uiCatalog.ts`（按名取的实现）、
  `packages/plugins/plugin-theme-components/src/index.ts`（登记处）
