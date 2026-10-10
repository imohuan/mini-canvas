# 可配置主题色板

**一句话定位**：色板是"**用户能改的颜色**"的登记表 —— 每个颜色**亮 / 暗各一格**，
用户在设置面板里改色，宿主把它写成 `<html>` 上的内联 CSS 变量，全界面立刻跟着变。

**它属于哪一块**：渲染层。真源在 `packages/canvas-render/src/contracts/themePalette.ts`（纯逻辑，零 Vue），
接线在 `packages/canvas-render/src/host/themePaletteSettings.ts`。

## 它是什么

把它想成**一面调色盘墙**：墙上每个位置是一张**上下两格**的卡片（亮色一格、暗色一格）。
平时两格都盖着（用户没改过），墙的底色（`ui-theme.css` 里的默认值）露出来；
用户一旦改了某格，就往那格里**贴一张不干胶**（`<html>` 上的内联变量），盖住底色。

数据上每个颜色是一个 token，派生成两格：

~~~ts
// 文件：packages/canvas-render/src/contracts/themePalette.ts
// 格式：TypeScript 模块（摘录）
// 位置：色板的"两格制"核心思路（文件头注释原文）

/*
   accentColorLight → --uic-accent-color-light → :root     { --ui-accent: var(--uic-accent-color-light, #0891b2) }
   accentColorDark  → --uic-accent-color-dark  → html.dark { --ui-accent: var(--uic-accent-color-dark,  #0891b2) }
*/
~~~

**为什么两格要两个不同名字的变量**（源码注释原文）：内联样式写在 `<html>` 一个元素上，
没有"按主题分支"的余地 —— 同名会被后写的覆盖掉。拆成两个名字，由 `ui-theme.css` 的
`:root` / `html.dark` 各自挑一个，才是纯 CSS 切换（切主题零 JS、零重渲染）。

**消费方照旧只写一次**：

~~~css
/* 文件：任意插件的 .vue 的 <style scoped> */
.my-active { background: var(--ui-accent, #0891b2); }
~~~

组件**不知道**有几套主题 —— `--ui-accent` 在亮色下指到 `--uic-accent-color-light`，暗色下指到
`--uic-accent-color-dark`，都是 `ui-theme.css` 的事。

## 为什么需要它

**因为"两套主题，但你这边配置的只有一种颜色"**（这是用户的原话，写在该文件头）。
根因：旧配置的 `color` 字段是**单值** —— 连接线设成灰色，暗色主题上就没法看了。

同一个颜色的亮 / 暗需求天然不同，例子就藏在默认值里：

| token | 亮色默认 | 暗色默认 | 为什么不同 |
| --- | --- | --- | --- |
| `dangerColor` | `#ef4444` | `#f87171` | 暗底上要更亮一档才够对比 |
| `edgeRailColor` | `#1f2937` | `#9ca3af` | 深灰导轨在暗画布上几乎看不见（对比度约 1.3:1） |
| `edgeFlowColor` | `#0891b2` | `#22d3ee` | 暗底流光用亮青 |

## 怎么用

### 色板里有什么（`THEME_COLOR_TOKENS`）

~~~ts
// 文件：packages/canvas-render/src/contracts/themePalette.ts
// 格式：TypeScript 模块（THEME_COLOR_TOKENS 的关键字段，逐字摘录）
// 位置：色板内容的单一真源；加新颜色 = 在这里加一行（+ 在 ui-theme.css 两侧各接一次）

export interface ThemeColorToken {
  /** token 基名（camelCase）：accentColor → accentColorLight / accentColorDark */
  key: string
  /** 消费方写的 CSS 变量名（真源在 ui-theme.css，这里只登记名字，供测试比对不漂移） */
  cssVar: string
  /** 设置面板里的中文名 */
  label: string
  /** 一句话说明这个颜色用在哪 */
  description: string
  /** 亮色主题下的默认值（hex） */
  light: string
  /** 暗色主题下的默认值（hex） */
  dark: string
  /** 是否**允许留空**（设置面板里能把这个颜色删掉 → 回落主题色） */
  optional?: boolean
}

export const THEME_COLOR_TOKENS: readonly ThemeColorToken[] = Object.freeze([
  /* accentColor        cssVar: --ui-accent       强调色（亮暗都是 #0891b2） */
  /* accentHoverColor    cssVar: --ui-accent-hover 强调色悬停（#0e7490） */
  /* dangerColor         cssVar: --ui-danger       危险色（#ef4444 / #f87171） */
  /* warnColor           cssVar: --ui-warn         警示色（#e3a25f） */
  /* edgeRailColor       cssVar: --ui-edge-rail    连线颜色（#1f2937 / #9ca3af） */
  /* edgeFlowColor       cssVar: --ui-edge-flow    流光颜色（#0891b2 / #22d3ee，optional） */
])
~~~

两条设计边界（注释原文的意思）：

- **只收"跨主题语义稳定、且用户真的会想改"的颜色**。背景 / 面板 / 文字这类**结构性**颜色留在 UI 规范里，
  不进色板 —— 它们成套联动，单拆一格出来改只会把主题改"脏"。
- **`light` / `dark` 必须是不透明 hex**（内核 `color` 配置只收 hex）。半透明档一律用 `color-mix` 从主色现算，
  不要塞进色板（那样改主色时会"改一半"）。

### API 逐个过一遍

这一节把 `themePalette.ts` 的公开面列全。它们分三组：**派生**（从 token 表算出格子）、
**解析**（从设置值算出当前颜色）、**接线**（宿主声明 + 落值）。

~~~ts
// 文件：packages/canvas-render/src/contracts/themePalette.ts
// 格式：TypeScript 模块（公开面签名，逐字摘录）
// 位置：色板 API

/** 亮色主题的配置分组（一级「常规」，与其它设置同层；二级点明是哪个主题） */
export const THEME_COLOR_LIGHT_GROUP = '常规/主题配色'
/** 暗色主题的配置分组 */
export const THEME_COLOR_DARK_GROUP = '常规/暗色主题配色'

/** camelCase → kebab-case（accentHoverColor → accent-hover-color） */
function kebab(name: string): string

/** 亮色那格的 settings key：accentColor → accentColorLight */
export function themeColorLightKey(key: string): string
/** 暗色那格的 settings key：accentColor → accentColorDark */
export function themeColorDarkKey(key: string): string

/** 某一格写入的内联变量名：--uic-<token-kebab>-<light|dark> */
export function themeColorInlineVar(key: string, mode: ThemeColorMode): string

/** 色板展平成 2×N 格（唯一派生入口；Config / 变量 / 归类都从它来） */
export function themeColorSlots(): ThemeColorSlot[]

/** 生成本色板的 Config schema（登记进 settings → 设置面板自动长出取色器） */
export function buildThemeColorConfig(): ConfigSchema

/** 色板全部内联变量名（插件卸载时逐个清掉，防"幽灵变量"挡住下一个主题） */
export function themeColorVarNames(): string[]

/** 是否属于本色板的 key（订阅回调里只认自己的 key，别人的变化不误触） */
export function isThemeColorKey(key: string): boolean

/**
 * 从取值器解析出**用户改过的那几格**（纯函数）—— 只返回与 token 默认值不同的项。
 * 等于默认值就不写：内联变量优先级最高，会把主题插件在 CSS 里给的配色一起压掉。
 */
export function resolveThemeColorOverrides(get: (key: string) => unknown): ThemeColorVar[]

/**
 * 取某个 token 在指定主题下的当前值（给**非 CSS 通道**的消费方用）。
 * optional token 的显式空串 = 用户删掉了自定义色 → 跟随主题强调色。
 */
export function resolveThemeColorValue(
  get: (key: string) => unknown,
  key: string,
  mode: ThemeColorMode,
): string | undefined

/** 取当前主题模式（<html class="dark"> 为准；无 DOM 环境一律 light） */
export function currentThemeMode(root?: Element | null): ThemeColorMode

/** 订阅主题模式变化（全仓唯一一处 <html> 监听，多个订阅者共用同一个观察器） */
export function watchThemeMode(cb: (mode: ThemeColorMode) => void, root?: Element | null): () => void

/** 色板插件的模块名（装配清单与诊断里按它找） */
export const THEME_PALETTE_PLUGIN_NAME = 'canvas-theme-palette'
~~~

两个返回形状：

~~~ts
/** 展平后的一格：一个 token × 一个主题模式 = 一个 Config 字段 = 一个内联变量 */
export interface ThemeColorSlot {
  token: ThemeColorToken
  mode: ThemeColorMode   // 'light' | 'dark'
  settingKey: string     // settings 里的 key（Config 字段名）
  cssVar: string         // 这一格写入的内联 CSS 变量名
  default: string        // 默认值（hex）
  group: string          // 设置面板分组
}

/** 一格内联变量的赋值 */
export interface ThemeColorVar {
  name: string
  value: string
}
~~~

### 宿主怎么接入

~~~ts
// 文件：packages/canvas-render/src/host/themePaletteSettings.ts
// 格式：TypeScript 模块（公开面签名，逐字摘录）
// 位置：把色板接进宿主的两个动作 —— 声明与落值

/**
 * 声明这组配色进 settings（幂等：已声明过就跳过，供多次 boot / 多宿主场景）。
 * 逐格 define：本表两格分属两个分组（亮 / 暗各一个页签），按 group 分桶后各申报一次。
 */
export function defineThemePaletteSettings(settings: SettingsStore): void

/**
 * 接上色板：立刻写一次当前值，并订阅后续变化实时写。
 * @returns dispose：解除订阅并清掉内联覆盖（CSS 回落到 ui-theme.css 的默认值）
 */
export function installThemePalette(
  settings: ThemePaletteSettingsLike | undefined,
  root?: HTMLElement,
): () => void
~~~

`installThemePalette` 内部的关键取舍（注释原文的意思）：

- **全格遍历**：改过 → 写内联；没改过（或改回默认）→ `removeProperty` 清掉内联，把控制权还给 CSS。
- **空串 = 用户删掉了这个自定义色** → 清掉内联，回落 CSS（主题色）。
- **dispose 会清掉所有内联覆盖**，否则"幽灵变量"会挡住下一个主题。

宿主调用点（`createMiniCanvasHost.ts`）在上一页贴过：先 `defineThemePaletteSettings`，
`restore()` 之后再 `installThemePalette` —— 顺序反了的话，用户上次存的配色要等下一次改动才可见。

### 写插件的姿势：什么时候必须用 `useThemeColor`

判断标准一句话（`useThemeColor.ts` 注释原文）：

> 这个值最终是不是"一个 CSS 声明"？是 → 走 CSS；不是（要喂给 API / 属性）→ 用本函数。

| 场景 | 用什么 | 为什么 |
| --- | --- | --- |
| 组件样式（`<style>` / `:style`） | `var(--ui-xxx, 兜底)` | 纯 CSS 切主题零 JS、零重渲染，比经 JS 转一手更快也更不容易漏 |
| SVG **表现属性 / 渐变 stop** | `useThemeColor(tokenKey)` | `setAttribute('stop-color', 'var(--x)')` **不生效** —— `var()` 只在 CSS 声明里解析，表现属性不认 |
| canvas 2D（`ctx.fillStyle`） | `useThemeColor(tokenKey)` | API 吃不到 CSS 变量 |
| 要把色值算进几何的地方 | `useThemeColor(tokenKey)` | 同上 |

`useThemeColor` 的用法（真实消费点：默认主题的连线组件 `CustomEdge.vue`）：

~~~ts
// 文件：packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue（摘录）
// 格式：Vue 组件 <script setup>
// 位置：为什么必须经 JS —— :stroke="edgeColor" 是 SVG 表现属性，var(--x) 在这里不解析
const railPalette = useThemeColor('edgeRailColor')
const flowPalette = useThemeColor('edgeFlowColor')
// 末尾那个字面量只是"既没配显式色、又拿不到色板"（无 DOM 的单测 / 极简宿主）时的最后兜底
const edgeColor = computed(() => visual.value.edgeColor || railPalette.value || '#3b82f6')
~~~

它的三条规矩（`packages/canvas-render/src/contracts/useThemeColor.ts`）：

1. **必须在 `<CanvasHost>` 渲染子树内调用**（内部用 `useCanvasRender()` 拿 ctx）。
2. **响应两件事**：用户在设置面板改色（`settings.onChange`）+ 切亮 / 暗主题
   （`watchThemeMode` —— 全仓唯一一处 `<html>` 监听，几百条连线共用一个观察器，
   而不是每条边挂一个 `MutationObserver`）。
3. **读不到 settings（极简宿主 / 单测桩）时回落 token 默认值，不抛错**。

### 可留空的颜色（optional）

`edgeFlowColor` 这类 token 声明了 `optional: true`：设置面板里能把这个颜色**删掉**。
删除的语义是**"跟随主题强调色"**（用户口径："颜色支持删除，删除之后默认使用主题颜色"）。
实现上有个容易写错的分界，源码注释专门区分了两种"没有"：

| 设置里的值 | 含义 | `resolveThemeColorValue` 返回 |
| --- | --- | --- |
| `undefined`（没设置过） | 保持默认值，**不是**"清除" | 该 token 的 `default` |
| `''`（显式空串） | 用户**删掉了**自定义色 | **跟随主题强调色**（`accentColor` 在该主题下的值） |
| 正常 hex | 用户选的颜色 | 该 hex |

`installThemePalette` 与 `resolveThemeColorOverrides` 遵守同一条规则 —— 三处一致，
所以"设置面板删色"与"JS 里读色"不会各说各话。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| 色板真源 | `packages/canvas-render/src/contracts/themePalette.ts` | token 表、两格派生、解析与订阅 |
| 宿主接线 | `packages/canvas-render/src/host/themePaletteSettings.ts` | `defineThemePaletteSettings` + `installThemePalette` |
| 宿主时序 | `packages/canvas-render/src/host/createMiniCanvasHost.ts` | define → `restore()` → install（顺序不能反） |
| 取色（JS 通道） | `packages/canvas-render/src/contracts/useThemeColor.ts` | SVG 表现属性 / canvas 2D 的响应式取色 |
| 连线组件 | `packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue` | `useThemeColor('edgeRailColor')` / `('edgeFlowColor')` |
| 参考线插件 | `packages/plugins/plugin-align-guide/src/alignGuidePlugin.ts` | 自己申报 `--uic-align-guide-light/dark`（用户口径：参考线颜色放专门插件里） |
| 成品应用 | `packages/ui/src/composables/appTheme.ts` | 首页等页面复用同一套 `applyThemeMode` / `installThemePalette` |
| 不漂移测试 | `packages/canvas-render/src/contracts/__tests__/themePalette.test.ts` | 钉住"token 表 ↔ ui-theme.css 两侧不漂移"（漏一侧 = 切主题不变色，肉眼极难发现） |

## 完整例子

下面这个小插件做一件事：往**所有节点**的 `title` 区域挂一个小徽章，
徽章里画一个**SVG 圆点 + 渐变流光**。因为 SVG 表现属性吃不到 `var()`，
颜色必须经 `useThemeColor('edgeFlowColor')` 取——这正是色板的"JS 通道"。

同样的文件在仓库里也放了一份，可直接打开对照：
`packages/docs/public/examples/theme/palette/plugin-flow-badge/`。

### 目录树

~~~
plugin-flow-badge/
├── package.json                # 清单：包名 / 入口 / miniCanvas 元信息
└── src/
    ├── index.ts                # 插件入口：把徽章挂到所有节点的 title 位
    └── FlowBadge.vue           # SVG 徽章：用 useThemeColor 取流光色
~~~

### `package.json`（全文）

~~~json
{
  "name": "@mini-canvas/plugin-flow-badge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "演示：流光徽章",
    "description": "SVG 表现属性吃不到 var()，用 useThemeColor 取色板当前值",
    "pluginName": "flow-badge",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/canvas-render": "workspace:*"
  },
  "peerDependencies": {
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
~~~

### `src/FlowBadge.vue`（全文）

~~~vue
<!-- 文件：packages/docs/public/examples/theme/palette/plugin-flow-badge/src/FlowBadge.vue
     格式：Vue 单文件组件（title 区域的小徽章）
     位置：插件包内部；由 ctx.nodes.attach('*', { region: 'title' }) 挂到所有节点上 -->
<script setup lang="ts">
// ① SVG 表现属性吃不到 var() —— :fill="color" 是属性，不是 CSS 声明。
//    所以颜色必须经 useThemeColor 取具体色值（JS 通道）。
import { useThemeColor } from '@mini-canvas/canvas-render'

const flow = useThemeColor('edgeFlowColor')   // 可留空 token：清空 = 跟随强调色，这里拿到的就是跟随后的值
const rail = useThemeColor('edgeRailColor')
</script>

<template>
  <!-- ② 静态边框可以走 CSS（span 的 border 在 <style> 里用 token）；
         动态色只喂给 SVG 属性 -->
  <svg class="flow-badge" viewBox="0 0 32 16" aria-hidden="true">
    <defs>
      <linearGradient id="flow-badge-grad" x1="0" y1="0" x2="1" y2="0">
        <!-- ③ stop-color 是表现属性：写 var(--x) 不生效，必须给具体值 -->
        <stop offset="0" :stop-color="flow" />
        <stop offset="1" :stop-color="flow" stop-opacity="0.15" />
      </linearGradient>
    </defs>
    <circle cx="8" cy="8" r="4" :fill="rail" />
    <rect x="16" y="6" width="14" height="4" rx="2" fill="url(#flow-badge-grad)" />
  </svg>
</template>

<style scoped>
.flow-badge {
  width: 32px;
  height: 16px;
  border-radius: 4px;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));   /* ④ 能写 CSS 的地方仍然只用 token */
}
</style>
~~~

### `src/index.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/theme/palette/plugin-flow-badge/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import FlowBadge from './FlowBadge.vue'

export const name = 'flow-badge'
// 组件只往 title 位挂东西，不直接碰数据服务
export const inject = [] as string[]

export function apply(ctx: Context) {
  // ① 挂到所有节点的标题位：type 传 * = 通配；随本插件卸载自动摘除
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'flow-badge/dot',
    component: FlowBadge,
  })

  // ② 诊断命令：把色板的 12 格（6 个 token × 亮 / 暗）在 settings 里的当前值念出来
  ctx.commands.register({
    id: 'flow-badge:report',
    title: '流光徽章：念念色板',
    run: () => {
      const settings = ctx.tryGet<{ get(k: string): unknown }>('settings')
      // themeColorSlots 是色板派生的唯一入口：token 表 → 2×N 格
      import('@mini-canvas/canvas-render').then(({ themeColorSlots, resolveThemeColorValue }) => {
        for (const slot of themeColorSlots()) {
          const v = settings
            ? resolveThemeColorValue((k) => settings.get(k), slot.token.key, slot.mode)
            : slot.default
          console.log('[flow-badge] ' + slot.settingKey + ' → ' + slot.cssVar + ' = ' + String(v))
        }
      })
      return true
    },
  })
}
~~~

**两步各自的意思**：

1. `ctx.nodes.attach('*', { region: 'title' })` 与节点类型注册那套是同一个接缝
   （见 [注册节点类型与区域词](/canvas-data/node-types)）；这里只是借用它来放一个演示徽章。
2. `themeColorSlots()` 是**读色板的正确姿势**：不要自己手抄 `--uic-*` 名字 ——
   token 表 ↔ CSS 两侧的一致性由 `themePalette.test.ts` 钉着，抄一份就等于把那份保险拆了。

### 怎么验证

1. `pnpm -C packages/ui dev` 起画布，把插件装进 `APP_PLUGINS`（或经「插件管理」热装）。
2. 所有节点的标题位会出现一个小徽章：圆点用连线导轨色、横条用流光色。
3. 打开设置面板 →「常规 / 主题配色」把**连线颜色**改成一个亮黄，暗色页签里把**流光颜色**改成品红，
   徽章与连线同时变色（改色即时生效）。
4. 把「流光颜色」**清空**（取色器旁的清除按钮）→ 流光跟随强调色（青色）—— 这就是 optional 的语义。
5. 点右上角调色板切亮 / 暗：徽章与连线各用各的那一格，`<html>` 只变了 class。

## 常见坑

1. **组件里别写 `var(--uic-…)`。**
   `--uic-*` 是**宿主写、主题表读**的内联通道（优先级最高，会压掉主题插件给的配色）。
   组件只该读 `--ui-accent` 这类语义 token；要具体色值（喂给 SVG / canvas）用 `useThemeColor`。

2. **内联变量优先级最高，"等于默认值就不写"是刻意的。**
   `resolveThemeColorOverrides` 只返回与 token 默认值**不同**的项 —— 用户没动过的格子保持"不写"，
   CSS 侧的默认值与主题插件才拿得到控制权；一旦真改了，那一格才以最高优先级钉住。

3. **"没设置过"和"删掉了"是两回事。**
   `undefined` = 没这一步，用 token 默认值；显式空串 = 用户删掉自定义色，跟随主题强调色。
   `resolveThemeColorValue` 的注释专门警告："两者必须区分，否则没设过的格会被误判成跟随强调色"。

4. **别每个组件各挂一个 `<html>` 观察器。**
   `watchThemeMode` 把观察器收成**单例**（首个订阅者到来时挂、最后一个离开时卸）。
   消费方是每条边组件一份 —— 一张画布几百条连线就是几百个组件，各挂各的观察器代价与元素数成正比，
   还会出现"A 已响应、B 还没"的中间态闪一下。

5. **加新颜色要两边一起接。**
   在 `THEME_COLOR_TOKENS` 加一行，还要在 `ui-theme.css` 的 `:root` / `html.dark` 两侧各接一次。
   只加一侧的表现是"切主题不变色"，且很难靠肉眼发现 —— 所以有专门的测试把两侧钉在一起
   （`packages/canvas-render/src/contracts/__tests__/themePalette.test.ts` 的"token 表 ↔ ui-theme.css 不漂移"）。

6. **参考线颜色不在宿主色板里。**
   它属于 `plugin-align-guide` 插件，由该插件自己申报 `--uic-align-guide-light/dark`
   （用户口径："参考线的颜色放到专门的参考线插件里面"）。插件卸载时配置跟着消失；
   CSS 侧 `--ui-guide` 兜底直通 `--ui-accent`。你想加"某个插件专属的颜色"，照它这个模式走。

