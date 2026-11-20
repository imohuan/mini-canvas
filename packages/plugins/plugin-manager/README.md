# 插件管理

> `@plume-canvas/plugin-manager` - v0.1.2

设置面板「插件」页：安装 / 卸载 / 重装第三方插件（清单来自云端或本地 dev 服务）.

## 注册项

### 提供的服务 (ctx.inject / provide)

- `plugin-manager`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `settings.nav`
- `settingsGroup/`
- `app.projects.tabs`

## 安装

```bash
npm i @plume-canvas/plugin-manager
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
