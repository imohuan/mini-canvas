# 主题通用组件

> `@plume-canvas/plugin-theme-components` - v0.1.2

默认主题的通用件：组件库目录 / 设置面板 / 外观变量 / 通知服务（应用级常驻）.

## 功能说明

@plume-canvas/plugin-theme-components —— 默认主题的**通用组件**半边（应用级常驻）。
只做与画布无关的事：
- 外观变量（圆角 / 字体 / 尺寸）交接给组件库
- 通用 UI 目录（Button / DropdownMenu / Toaster / mediaViewer …）
- 设置面板与设置菜单
- 全局通知服务
画布外观（节点壳 / 边 / 背景 / 节点工具栏）在 @plume-canvas/plugin-theme-canvas，
两个包互不 import；启动默认值住在引擎 @plume-canvas/canvas-render。
/

## 注册项

### 提供的服务 (ctx.inject / provide)

- `notify`
- `feedback`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `settings.nav`

## 安装

```bash
npm i @plume-canvas/plugin-theme-components
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
