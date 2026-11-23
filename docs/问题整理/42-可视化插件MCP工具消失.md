# 问题 42 · 可视化插件的 MCP 工具在 Agent 面板里消失

日期：2026-11-23

## 现象

Agent 对话的 MCP 面板里只有 11 个内置工具（canvas_* / generation_* / resource_*），
可视化插件注册的 canvas_ui_guide / canvas_ui_write 等 16 个工具全部不在。

## 排查过程

1. 直接 POST /mcp tools/list 确认服务端也只返回 11 个内置工具 —— 不是前端展示问题。
2. 用临时数据根 + 随包 assets/plugins 跑同一份 dist：27 个工具全在 → 源码链路（插件加载器 →
   server/mcp-tool 注册场 → mcp/server.ts 并入）没问题。
3. 对比线上进程的 /plugin-catalog.json：version 与 id 列表和「npm 包形态运行」的复现完全一致，
   且只有 plume-canvas__ 前缀的 id、没有随包裸名 → 线上跑的是 npm 安装的 @plume-canvas/server
   （数据根 C:/Users/Administrator/.plume），不是仓库里的 pnpm dev:server。
4. 检查 npm 上 @plume-canvas/plugin-node-ui 0.1.4：包里**有** dist/server.js，
   但 package.json 的 plume 段**没有 server.entry**（只有 web.entry）。

## 根因

发布脚本 `scripts/swap-dev-to-pub.cjs` 只回填 `plume.web.entry`，不回填 `plume.server.entry`。
于是安装路由（apps/server/src/routes/npmPlugins.ts）按声明找不到 server 半，装出来的插件副本
没有后台半 → plugin-node-ui 的 ctx.mcp.tool 注册从未发生。npm 版 server 包又不带 assets/plugins
兜底，那份残缺副本就是唯一副本，后台半彻底消失。

## 修复

1. 安装路由兜底：未声明 server.entry 时，包里若能解析出 dist/server.js 就照常复制，
   并把 server.entry 回填进安装后的 package.json（commit 70db9b8，含失败先行测试）。
2. 发布脚本补上 server.entry 回填（dist/server.js 存在即写声明），下次发布生效。

## 事后操作

已装出去的旧副本（两个数据根里都有）要靠「插件管理 → 检查更新」拉新包，或卸载重装一次，
安装路由的兜底就会把后台半补回来。仓库内 pnpm dev:server 因有随包 assets 兜底，一直不受影响。
