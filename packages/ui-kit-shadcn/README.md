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
