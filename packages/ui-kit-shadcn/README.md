# @mini-canvas/ui-kit-shadcn

基于 shadcn-vue（preset `a2vfIHS`，reka-ui + Lucide）的组件库，附带取色器与可视化主题配置。

## 看效果

```bash
pnpm -C packages/ui-kit-shadcn dev
```

打开 http://localhost:5295/ 。页面顶部是主题配置（Base Color / Theme / Chart Color / Heading / Font / Radius），
改动实时生效，并可一键复制对应的 CSS 变量；下面是按真实用法摆出的组件与交互。

## 引入

```ts
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@mini-canvas/ui-kit-shadcn'
```

宿主样式入口里引入一次（Tailwind v4）：

```css
@import "@mini-canvas/ui-kit-shadcn/styles.css";
@source "../../ui-kit-shadcn/src";
```

`styles.css` 把 shadcn 的颜色映射到项目现有的 `--ui-*` 变量，亮暗主题跟随 `<html class="dark">`。

### 主题交接（真实应用里）

默认主题插件（`plugin-theme-default`）是外观配置的唯一入口：

| 配置项 | 写入的变量 | 谁消费 |
| --- | --- | --- |
| 圆角 `themeRadius` | `--mct-radius` | `styles/host.css` 按 `data-slot` 覆盖按钮 / 输入框 / 卡片 / 浮层 |
| 正文字体 `themeFont` | `--mct-font-body` | `<html>` + 外壳 / 设置壳 / 节点壳（都写 `var(--mct-font-body, 原栈)`） |
| 标题字体 `themeHeadingFont` | `--mct-font-heading` | 组件标题（`cn-font-heading`）+ 设置页小标题 |

颜色不在这里另写一份：`styles.css` 已经把 shadcn 语义色映射到 `--ui-*`，
而 `--ui-*` 由 canvas-render 的主题色板（设置 → 外观 → 主题配色）驱动。

开发期还有一个开关「设置 → 常规 → 调试 → 组件库使用标记」：打开后每个 shadcn 组件右上角出现一个小圆点，
鼠标悬停显示它被使用的文件与行号。模板里直写的使用点由 Vite 插件（`vite-plugin-debug-loc`）注入；
按名登记进 `registryOf('ui')` 的组件由 `withUiKitDebugMark` 包一层透明标记（不改变 props / slots / 事件）。

## 目录

- `src/components/ui/*`：shadcn-vue 原始组件，未做包装。
- `src/components/color-picker/*`：Vuelor 取色器（CLI 从 `https://vuelor.dev` 安装）。
- `src/components/preview/ThemePanel.vue`：预览页的主题配置面板（内部用 DropdownMenu 分离件拼下拉，不进组件库公开 API）。
- `src/theme/*`：主题色板、字体、圆角预设与实时变量写入。

## 检查

```bash
pnpm -C packages/ui-kit-shadcn typecheck
pnpm -C packages/ui-kit-shadcn build
```
