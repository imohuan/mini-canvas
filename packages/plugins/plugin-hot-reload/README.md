# 热重载

> `@plume-canvas/plugin-hot-reload` - v0.0.0

开发用：手动登记几条链接（cloud-server 的 SSE / 插件自己的 vite dev server），产物一变自动重装插件.

## 功能说明

plugin-hot-reload · 热重载插件（KV 门铃通知 → HEAD 对比 → 自动重装）。
## 最终形态（用户口径）
  watch 工具：盯 src → 自动 build → 成功后 PUT /api/kv/config/plugin-watch:<插件名>
  后台：      KV 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成，零改动）
  本插件：    监听该前缀 → HEAD 对比产物 → 变了才拉新重装 → 弹通知
没有可登记的 SSE 链接、没有 UI 面板 —— 监听是自动的（复用宿主共享 KV 通道，零新连接），
提示走上下文里的 notify 服务（默认主题提供；本插件不 import 任何通知库）。
装载即生效，宿主 APP_PLUGINS 放 hotReloadPlugin 一个即可。
## 导出面
- hotReloadPlugin：宿主装配用（推荐）
- createHotReload / HotReload：数据层（测试、或宿主想自建 UI 时用）
- PLUGIN_WATCH_PREFIX：watch 工具 PUT 的 key 前缀约定
/

## 注册项

### 提供的服务 (ctx.inject / provide)

- `hot-reload`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `settings.nav`
- `settingsGroup/`

## 安装

```bash
npm i @plume-canvas/plugin-hot-reload
```

本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。
