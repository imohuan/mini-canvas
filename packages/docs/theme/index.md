# 主题与配色

**一句话定位**：主题就是**一整套 CSS 变量**。写组件时只说"用面板色""用强调色"，
不说"用 #ffffff" —— 于是换主题就是换那套变量的值，组件一行不改。

**它属于哪一块**：渲染层 `@mini-canvas/canvas-render`。
变量表在 `packages/canvas-render/src/styles/ui-theme.css`，它随 `canvas-render` **加载即生效**
（包入口 `src/index.ts` 顶部就 `import './styles/ui-theme.css'`）。

## 它是什么

把它想成**校服**：

- **同一件衣服**（组件的 CSS）谁都能穿，
- **配色方案**（变量表）每学期换一次，
- 换方案时**不用改衣服**，只要换布的颜色。

具体做法就是老一套的 CSS 自定义属性（`--名字`），写在 `<html>` 上，
后面所有组件都能读到。区别只在**组织方式**：

| 变量族 | 管什么 | 谁在用 |
| --- | --- | --- |
| `--ui-*` | 全画布通用 UI：画布底、面板、文字、边框、遮罩、阴影、强调色、语义色（危险 / 警示）、连线色、辅助线色 | 几乎每个插件的浮层与面板 |
| `--sf-*` | 设置字段（Settings Field）：标签、描述、开关轨道、开关圆点、输入框、气泡 | `plugin-theme-default` 的设置面板 |
| `--ps-*` | 精度滑块（Precision Slider）：轨道、强调色、圆点 | 数值微调的滑块 |
| `--dd-*` | 下拉浮层（Dropdown / Select）：底色、边框、文字 | 各种下拉菜单 |
| `--ntb-*` | 节点上 / 下控制栏（Node Toolbar）：按钮填充、文字、聚焦环、激活态 | 节点外的操作条 |
| `--uic-*` | **色板内联通道**：`--uic-<颜色名>-<light\|dark>`，由宿主按用户配置写进 `<html>` 内联样式 | 只有 `ui-theme.css` 读它 |

> 顺带一个全局类：`.ntp-root`（节点控制栏容器 —— 排一行 + 一块面板）。
> 它不进 scoped 样式是刻意的：**scoped 只作用于本组件模板**，插件想复用就得各抄一遍，
> 那正是"底色一处 `--ui-panel`、三处 `--ui-overlay-solid`"开始漂移的来源。

### 变量族怎么分工（照 `ui-theme.css` 的实际注释）

- **`--ui-*` 是"画布/界面"那一层** —— 浮层挂在**画布背景**上而不是卡片里，所以跟着 `--ui-*` 走，
  才不会在暗色画布上出现一块白板。
- **`--ntb-*` 是"节点控制栏"那一层** —— 它浮在卡片外的画布上，所以有自己的一套（按钮默认透明，只有 hover 才上色）。
- **`--sf-*` / `--ps-*` / `--dd-*` 是"设置面板里那几种控件"** —— 名字短是因为它们只在面板内部出现。
- **`--uic-*` 不是给组件用的** —— 它是**宿主写、主题表读**的通道，组件永远不该直接写 `var(--uic-…)`。

### 派生色一律现算，不写死

几个"半透明档"是从主色**现算**的，不是各写一个 rgba：

~~~css
/* 文件：packages/canvas-render/src/styles/ui-theme.css（逐字摘录） */
:root {
  /* soft 档由强调色现算（color-mix）：用户改强调色后，选中底 / 聚焦环等半透明变体自动跟随，
     不会出现“主色改了、半透明底还是青的”这种漂移。 */
  --ui-accent-soft: color-mix(in srgb, var(--ui-accent) 12%, transparent);
  --ui-danger-soft: color-mix(in srgb, var(--ui-danger) 14%, transparent);
  --ui-guide: color-mix(in srgb, var(--uic-align-guide-light, var(--ui-accent, #3b82f6)) 75%, transparent);
}
~~~

同一个理由也用在下游：`--ntb-active-bg`、`--sf-bubble-bg` 都从 `--ui-accent` 现算。
注释写得很直白："写死 rgba 的话，用户把强调色改成紫色后主色变了、这些派生档还是青的 —— 就是‘改一半’的漂移。"

## 为什么需要它

**因为"颜色"是全局的，而"组件"是局部的。**

这套变量表的起源写在 `ui-theme.css` 的文件头：早先 `--ui-*` / `--sf-*` / `--ps-*` / `--dd-*`
只定义在成品应用的 `packages/ui/src/app.css` 里，**插件拿不到** ——
于是 `context-menu` / `node-find` / `shortcut-manager` / `mini-map` 这些插件只能各写一套硬编码浅色值。
结果：**暗色主题下这些浮层永远是"白底黑字"**，而且每个插件都要自己发明一个 `theme` 配置项。

现在这套表放在 `canvas-render` 里（24 个插件里绝大多数都依赖它），所有渲染插件自动获得同一套 token；
宿主应用不再重复定义，直接消费。

不这么做会怎样，有两个具体后果：

1. **换主题要改 N 个文件**（每个插件一份）。
2. **改主色只会"改一半"** —— 主按钮变了，选中底、聚焦环、滑块还是旧色。

## 怎么用

### 宿主怎么切主题

宿主**只是在 `<html>` 上加减一个 class**，纯 CSS 命中不同分支 —— 零 JS、零重渲染：

~~~css
/* 文件：packages/canvas-render/src/styles/ui-theme.css（逐字摘录，注释也是原文） */
/* ===== 亮色（默认 / :root）===== */
:root {
  --ui-canvas-bg: #f5f6f8;
  --ui-panel: #ffffff;
  /* …约 70 个 --ui-* / --ntb-* / --sf-* / --ps-* / --dd-* 变量… */
}

/* ===== 暗色：<html class="dark">（兼容 data-canvas-theme='dark' 旧写法，同规则共享值）
   用 html.dark 而不是 .dark：拿到 0,1,1 特异性，避免被任何后加载的 :root 规则盖掉。===== */
html.dark,
html[data-canvas-theme='dark'] {
  --ui-canvas-bg: #141414;
  --ui-panel: #262626;
  /* …同一批变量，换一套值… */
}
~~~

**为什么两个选择器写在同一条规则里**：`data-canvas-theme` 是旧写法（首页与外部宿主还在用），
`.dark` 是 Tailwind v4 / shadcn 的通行做法。写在一起 = 值完全共享、没有第二份要维护。

谁把 class 加上去的？渲染层的 `themeModeSettings`：

~~~ts
// 文件：packages/canvas-render/src/contracts/themeModeSettings.ts
// 格式：TypeScript 模块（逐字摘录）
// 位置：主题模式作为渲染层配置的声明与落值

/** 设置 key（settings 全局平面命名，先声明者独占） */
export const THEME_MODE_KEY = 'themeMode'
/** 设置面板里的分组：一级「常规」/ 二级「外观」（与「常规/画布」同层） */
export const THEME_MODE_GROUP = '常规/外观'
/** 默认暗色（对齐 index.html 首屏 class="dark"，避免首屏亮→暗闪一下） */
export const THEME_MODE_DEFAULT: ThemeMode = 'dark'

export type ThemeMode = 'light' | 'dark'

/** 把主题模式落到 DOM：增删 <html> 的 dark class，并同步保留 data-canvas-theme 属性 */
export function applyThemeMode(mode: ThemeMode, root?: HTMLElement): boolean

/** 声明主题模式进 settings（幂等：已声明过就跳过，供多宿主 / 多次 boot） */
export function defineThemeModeSetting(settings: {
  has(key: string): boolean
  define(group: string, items: Record<string, SettingSchema>, scope?: string): void
}): boolean

/** 接线：立刻按当前值落一次 DOM，并订阅后续变化实时落；返回 dispose（解除订阅） */
export function installThemeMode(
  settings: ThemeModeSettingsLike | undefined,
  root?: HTMLElement,
): () => void
~~~

宿主那边（`packages/canvas-render/src/host/createMiniCanvasHost.ts`）的时序是：

~~~ts
// 三条 declare/define 都在 save.settings.restore() 之前，用户的旧值才能在 define 时命中为初值
defineThemePaletteSettings(interactionSettings)   // 声明色板（见「可配置主题色板」那篇）
defineThemeModeSetting(interactionSettings)       // 声明亮 / 暗开关
await save.settings.restore()                    // 恢复用户上次存的值
const disposeThemePalette = installThemePalette(interactionSettings)  // 落色板内联变量
const disposeThemeMode = installThemeMode(interactionSettings)        // 落 <html class="dark">
~~~

**为什么"主题模式"要收进 `settings`**（而不是应用里随便一个变量）：
这样它就有三件事免费拿到 —— 设置面板自动长出一项、`save.settings` 自动持久化、任一宿主自带。
否则用户点了切换、刷新又回到默认（这正是改造前的实际表现）。

### 组件 / 插件写 CSS 的标准姿势

**一条规矩：只用 token，并且带兜底。**

~~~css
/* 文件：任意插件的 .vue 的 <style scoped> */
/* 格式：CSS（标准姿势） */
/* 位置：插件里的浮层 / 面板 / 按钮 */

.my-panel {
  background: var(--ui-overlay-solid, #ffffff);
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  color: var(--ui-ink, #374151);
}
.my-panel:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.my-danger { color: var(--ui-danger, #ef4444); }
~~~

三件事一次做完：

1. **有 token 就用 token** —— 换主题自动跟随，不用改一行。
2. **写兜底值** —— `var(--ui-panel, #ffffff)` 里那个 `#ffffff` 保证"脱离本主题表单独使用时也不崩"，
   本表缺失时行为与改造前一致（这是 `ui-theme.css` 文件头明写的设计）。
3. **不给自己的插件发明 `theme` 配置项** —— 这是被明确禁止的（见「常见坑」第 3 条）。

**需要半透明档时用 `color-mix` 现算，别写死 rgba**：

~~~css
/* 文件：任意插件的 .vue 的 <style scoped> */
/* 格式：CSS（派生色现算） */
/* 位置：聚焦环 / 选中底 */

.my-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
}
~~~

### 写在插件的哪里

变量表**不用你 import** —— 只要插件依赖 `@mini-canvas/canvas-render`（绝大多数插件都依赖），
`ui-theme.css` 就随包加载生效了。

> 一些插件的 `src/env.d.ts` 里会看到一段关于 `ui-theme.css` 的注释，那是给 TS 的 CSS 模块声明
> （本包 tsconfig 只覆盖自身 `src`，所以就地声明一次）。你写插件时**不需要**任何 import。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| 变量表本体 | `packages/canvas-render/src/styles/ui-theme.css` | 亮 / 暗两套值 + `.ntp-root` 全局类 |
| 包入口 | `packages/canvas-render/src/index.ts` | `import './styles/ui-theme.css'` —— 加载即生效 |
| 主题模式 | `packages/canvas-render/src/contracts/themeModeSettings.ts` | `THEME_MODE_KEY` / `applyThemeMode` / `installThemeMode` |
| 色板 | `packages/canvas-render/src/contracts/themePalette.ts` | 可配置颜色的两格制（[专页](/theme/palette)） |
| 宿主接线 | `packages/canvas-render/src/host/createMiniCanvasHost.ts` | `defineThemeModeSetting` + `installThemeMode` + 色板落值 |
| 默认主题插件 | `packages/plugins/plugin-theme-default/src/components/` | 节点壳 / 边 / 背景 / 设置面板，全部走 token |
| 右键菜单 | `packages/plugins/plugin-context-menu/src/ContextMenu.vue` | 注释写着"配色全部走通用 UI token，本组件不带任何主题配置项" |
| 多选框 | `packages/plugins/plugin-multi-select/src/BoxSelectLayer.vue` | 颜色走 `--ui-select-box`，自定义色为空时回落主题 token |
| 对齐辅助线 | `packages/plugins/plugin-align-guide/src/alignGuidePlugin.ts` | 自己申报 `--uic-align-guide-light/dark` 两个内联变量 |
| 成品应用 | `packages/ui/src/composables/appTheme.ts` | 复用 `applyThemeMode` / `installThemePalette`；`@custom-variant dark` 写在 `packages/ui/src/app.css` |

## 常见坑

1. **`@custom-variant dark` 必须写在带 `@import "tailwindcss"` 的入口里。**
   `ui-theme.css` 的文件头明说：本文件不是 Tailwind 入口，写了**也不生效**；
   它写在 `packages/ui/src/app.css`（`@custom-variant dark (&:where(.dark, .dark *));`）。
   你在组件里写 `dark:` 变体能不能生效，取决于**你的应用入口**有没有这一行，而不是 canvas-render。

2. **不要照抄别人组件里的具体色值。**
   规范（`docs/design/ui-style-guide.md`）要求颜色一律来自 token 表。
   真实理由写在表里："翻转暗色主题时只需换底色，填充层级自动成立" —— 用黑色透明度而不是灰 hex，
   暗色就不用重调每一层灰。

3. **不要给单个插件发明 `theme` 配置项**（有一个明确的例外：全应用唯一一个主题开关）。
   早先每个插件各带一个 `theme`，等于把"选主题"这件全局的事拆成 N 份局部决定，
   两个组件同一时刻可以显示不同主题。现在：主题模式是**渲染层配置**（`themeMode`），全局一起换；
   插件只管用 token。

4. **写半透明档别写死 rgba，用 `color-mix` 从主色现算。**
   "改了一半"漂移在多个组件里都修过一轮（`--ntb-active-bg`、`--sf-bubble-bg`、`--ui-accent-soft` 的注释都是同一个理由）。
   反过来，`--uic-*` 色板里只收**不透明 hex**（kernel 的 `color` 配置只收 hex），透明档一律现算。

5. **暗色画布上连线要给浅色。**
   色板里 `edgeRailColor` 的亮 / 暗默认分别是 `#1f2937` / `#9ca3af`，源码注释写着"暗色画布上请给浅色，否则线会沉进背景里看不见"。
   自己写死连线颜色时同理 —— 别让暗色主题变成"消失的线"。

6. **别直接消费 `--uic-*`。**
   它是宿主写、主题表读的**内联通道**（优先级最高，会压掉主题插件给的配色）。
   组件该读的是 `--ui-accent` 这类语义 token —— 见[可配置主题色板](/theme/palette)。
