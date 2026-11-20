# 示例 · 插件演练场

> `@plume-canvas/plugin-demo-kit` - v0.0.0

开发演示合集：组件展厅、插槽与工具栏、外壳插槽、热重载靶子。装一个就够，不混进产品冷启动.

## 功能说明

plugin-demo-kit —— **一个插件，四套演示**。
为什么合并：以前它们是四个独立包（theme-gallery / ui-demo / shell-slots-demo /
hot-reload-demo）。用户口径 2026-11-01：「我的项目提供了很多 demo 插件，没有实际意义的，
你把他们整理整理放在一个插件里面」。四个包各自有 package.json、构建配置、清单身份，
装的时候还要在面板里找四次 —— 而它们其实都只是「开发时看看某个机制长什么样」。
合并后仍然是**可安装件**（不是自带件）：默认不随产品冷启动装配，
到「设置 → 插件 → 本地清单」装一次就能看到全部四套演示。
每套演示保留自己的 id 前缀（demo-kit/gallery、demo-kit/ui-slots…），
卸载插件时内核按归属统一回收，不会留半截浮层。
/

## 注册项

### 声明的依赖 (export const inject)

- `'doc'`

### 注册的插槽 (slots.register)

- `overlay`
- `image.topToolbar`
- `shell.status`
- `shell.dock`
- `shell.drawer.tabs`

## 安装

```bash
npm i @plume-canvas/plugin-demo-kit
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
