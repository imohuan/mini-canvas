# @mini-canvas/ui-kit-shadcn

基于 shadcn-vue（preset `a2vfIHS`，reka-ui + Lucide）的组件库，附带取色器与可视化组件配置。

## 看效果

```bash
pnpm -C packages/ui-kit-shadcn dev
```

打开 http://localhost:5295/ 。页面顶部是「组件配置」，一屏能改完这几项：

| 分组 | 配置 | 落到哪里 |
| --- | --- | --- |
| 样式 | 底色 Base Color、主题色 Theme、正文字体、标题字体、圆角 | CSS 变量（`--primary` / `--font-body` / `--radius` …） |
| 行为 | 控件尺寸 Size、浮层箭头、触发器间距 gap、额外偏移 offset、子菜单间距 | `componentConfig`（size 由注册薄层注入，其余由组件读） |

改完立刻作用到下面所有组件，包括 Teleport 到 body 的浮层。

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

默认主题插件（`plugin-theme-canvas`）是外观配置的唯一入口：

| 配置项 | 写入的变量 | 谁消费 |
| --- | --- | --- |
| 圆角 `themeRadius` | `--mct-radius` | `styles/host.css` 按 `data-slot` 覆盖按钮 / 输入框 / 卡片 / 浮层 |
| 正文字体 `themeFont` | `--mct-font-body` | `<html>` + 外壳 / 设置壳 / 节点壳（都写 `var(--mct-font-body, 原栈)`） |
| 标题字体 `themeHeadingFont` | `--mct-font-heading` | 组件标题（`cn-font-heading`）+ 设置页小标题 |

颜色不在这里另写一份：`styles.css` 已经把 shadcn 语义色映射到 `--ui-*`，
而 `--ui-*` 由 canvas-render 的主题色板（设置 → 外观 → 主题配色）驱动。

### 组件配置（`componentConfig`）

浮层的箭头 / 间距 / 偏移 / 二级菜单间距与控件尺寸走同一份响应式配置
（`src/componentConfig.ts` 的 `setComponentConfig`），读写方式只有这一个入口：

```ts
import { componentConfig, setComponentConfig, resetComponentConfig } from '@mini-canvas/ui-kit-shadcn'

setComponentConfig({ size: 'sm', arrowVisible: true, gap: 8, offset: 4, subGap: 12 })
resetComponentConfig() // 主题卸载时复位，避免幽灵配置挡住下一个主题
```

- `size` 只作用于**声明了 `size` prop** 的组件，由 `withComponentConfig` 薄层补默认值；
- `gap + offset` 是**累加**，箭头存在时间隔从箭头尖端量起；
- 预览页 `App.vue` 刻意从 `@/previewKit` 取组件，走的是和真实应用同一条薄层路径。

开发期还有一个开关「设置 → 常规 → 调试 → 组件库使用标记」：打开后每个 shadcn 组件右上角出现一个小圆点，
鼠标悬停显示它被使用的文件与行号。模板里直写的使用点由 Vite 插件（`vite-plugin-debug-loc`）注入；
按名登记进 `registryOf('ui')` 的组件由 `withUiKitDebugMark` 包一层透明标记（不改变 props / slots / 事件）。

## 目录

- `src/components/ui/*`：shadcn-vue 原始组件，未做包装。
- `src/components/color-picker/*`：Vuelor 取色器（CLI 从 `https://vuelor.dev` 安装）。
- `src/theme/ThemeConfigBar.vue`：预览页顶部的组件配置条（用 DropdownMenu 分离件拼下拉，不进组件库公开 API）。
- `src/theme/*`：纯预览页用的色板、字体与圆角预设，以及把配置写进变量的 `useThemePreview`。
- `src/theme/popup/*`：浮层几何（箭头高度、间距换算）与浮层互斥。
- `src/previewKit.ts`：预览页专用出口，给用到的组件套上和真实应用相同的 size 注入薄层。

## 检查

```bash
pnpm -C packages/ui-kit-shadcn typecheck
pnpm -C packages/ui-kit-shadcn build
```
