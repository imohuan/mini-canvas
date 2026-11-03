# 宿主插件门面 `window.MiniCanvas` —— 热装/热卸/热重载 设计

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**待用户审核后实现**
作者：code-developer

## 一、用户需求（已确认三点）
1. 门面形态 **A**：一个总对象 `window.MiniCanvas = { installPlugin, uninstallPlugin, reloadPlugin, getHost, getContext, listPlugins, ... }`。
2. **可复用**：门面做成独立可复用模块（放内核 `canvas-core-v2` 的宿主层，不绑 demo；以后真宿主直接拿来用，demo 只做薄消费方）。
3. **热装/热卸/热重载**：运行中装插件立即生效(UI 即现)；卸载自动回收副作用；重载=卸+装。**容错**：插件可声明 `hot:false` 表示不支持热装/热卸（这类插件只允许冷启动时装，卸载时提醒"需刷新/重启"，不硬卸以免坏状态）。

## 二、为什么现在不够（诊断）
- 内核 `Context.start()` 是**一次性拓扑装载**：`plugin()` 只能在 start 前登记，start 后不能再装。
- demo(CanvasDemo.vue) 手动 `import { nodeImagePlugin }` + `bootCanvas({plugins})`，把"装配哪些插件"写死在宿主源码里——这正是你要去掉的。
- 但没有运行时 `install/uninstall` 能力，热装热卸无从谈起。

## 三、目标架构

### 1. 内核 Context 补「动态装载」能力（最小、不破坏冷启动路径）
在 `Context` 上加（仅 start 之后可用，复用现有 Scope/生命周期）：
- `installPlugin(mod): Promise<string>` —— 为单插件建子 Scope → 跑 `setup` → 记录；返回插件名。
- `uninstallPlugin(name): void` —— dispose 该插件 Scope（副作用/注册/UI 全自动清）。
- `listPlugins(): string[]`
> 冷启动(plugin/start)原样保留；两者共用同一份 pluginScope 记录，确保热装与冷装插件统一可卸。

### 2. 可复用宿主门面模块 `packages/canvas-core-v2/src/host/`（新目录）
一个 `createMiniCanvasHost(opts)` 工厂，职责：
- 建 Context + 注入全部内核服务(save/nodeStore/selection/history/command/nodeFactory) + 建 NodeRegistry(展示注册表，供 Vue 层读)。
- 跑冷启动(内置 text/image/canvasCommands 或 opts 指定)。
- 暴露给 window 的 API 面：`installPlugin/uninstallPlugin/reloadPlugin/getHost/getContext/listPlugins`。
- 产出 `CanvasHostHandle`：宿主(Vue)拿它去 provide/渲染，**不 import 具体插件**。
- 产物类可被 `main.ts`（或真宿主）挂到 `window.MiniCanvas`。

### 3. demo 收薄
- CanvasDemo.vue：不再 `import` 具体插件、不再手 `bootCanvas` 装配；
  改为 `createMiniCanvasHost()` → 拿 registry/host → provide 给 VueFlow → 渲染。
- main.ts：boot 后 `window.MiniCanvas = host.api`。

### 4. 插件安装的两种来源（统一走门面）
```js
// 源码插件（import 后装）
import { nodeXxxPlugin } from '@mini-canvas/plugin-node-xxx'
window.MiniCanvas.installPlugin(nodeXxxPlugin)

// 以后打包好的独立 js（<script src> 或动态 import 载入后）
window.MiniCanvas.installPlugin(window.__SOME_PLUGIN__)   // 或插件脚本自己调
```
宿主代码不再新增 import/改装配；插件自描述、自己把自己装上。

## 五、实施步骤（每步原子 commit + 测试）
1. 内核 `Context.installPlugin/uninstallPlugin/listPlugins` + 单测（热装服务/UI、卸载回收副作用、防重名、未 start 拒绝）。
2. 建 `src/host/createMiniCanvasHost.ts` 门面工厂 + 单测（内置于 window 的 API 面行为）。
3. CanvasDemo 收薄改走门面；main.ts 挂 window.MiniCanvas。
4. 写一个"打包独立 js"演示插件（可选，用 vite 产出一个 iife/js 文件，页面动态加载后 installPlugin）验证"以后打包 js 能装"。
5. Chrome MCP 端到端：window.MiniCanvas 存在 → installPlugin 新插件立即出 UI → uninstallPlugin 消失 → 重载。
6. 全量回归(101+) + 文档(插件开发指南补"如何打包独立 js + 通过 window.MiniCanvas 安装")。

## 六、验证命令
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run     # 全绿
node ./node_modules/typescript/bin/tsc --noEmit
pnpm dev                                       # 浏览器里试 window.MiniCanvas
```

## 七、风险/注意
- 不动 101 个既有测试；新增动态装载是"加能力"，冷启动路径原样。
- 依赖方向：门面模块在 host 层(内核内)只管 opaque 注册表，不 import 任何插件；demo/宿主才是消费方。
- 热卸载：靠既有 Scope 自动回收，不手写 uninstall。
- `hot:false` 插件：门面卸载时给出提示、拒绝硬卸（保状态不坏），属显式设计而非 bug。

---
*待审核。可先做 Step 1(内核动态装载)让我看到方向再继续，或一口气全做。*
