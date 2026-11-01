# plugin-hot-reload

## 一句话

开发期热重载：监听 KV 变更，对比产物，自动重装插件。数据层可单测，插件壳只做单例与服务上架；主要风险是三套全局/固定接口暗契约（`MiniCanvasHotReload`、`MiniCanvasPlugin.reload`、`plugin-watch:*`）。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-hot-reload` | 插件名 `hot-reload` |
| 身份 | 内部件（`installable:false`），但写在 `APP_PLUGINS` 冷启动 |
| 源码 / 测试 | 3 个生产源文件 / 1 个测试文件（全包 4 个文件） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-data | `Context` 类型 | 是 | `src/index.ts:20` |
| ui | 无 import；依赖 `window.MiniCanvasPlugin` | **全局暗契约** | `src/data/hotReload.ts:219-224`；宿主挂载 `packages/ui/src/main.ts:72` |
| 其他插件 | 无 | — | — |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `window.MiniCanvasHotReload` | 全局单例管理器 | 插件自有，但挂全局 | `src/index.ts:29-47` |
| `hot-reload` 服务 | 对外暴露同一管理器，但当前仓库没有消费方 | 自有（预留） | `src/index.ts:49-50` |
| `window.MiniCanvasPlugin.reload` | 真正重装插件 | 硬（缺则自动重载失败） | `src/data/hotReload.ts:219-224` |
| `window.__miniCanvasKvEvents` | 复用宿主唯一 SSE | 可选（缺则自开 `EventSource`） | `src/data/hotReload.ts:519-550`；宿主 `packages/ui/src/composables/kvEvents.ts:31` |
| `/api/kv/events` | 变更通知 | 固定路径 | `src/data/hotReload.ts:535,539` |
| `plugin-watch:<name>` | KV 键前缀 | 固定约定 | `src/data/hotReload.ts:526-531`；写入方 `packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs:32` |
| `/plugin-catalog.json` | 按插件名找产物地址 | 固定路径 | `src/data/hotReload.ts:245-254,470-480` |
| `vue-sonner` | 自动重载成功通知 | 可选依赖（延迟 import） | `src/data/hotReload.ts:230-243`；宿主 Toaster `packages/ui/src/Root.vue:7,21` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `globalThis.MiniCanvasHotReload` | 单例 | 中：绕过服务表；卸载后不清 | `src/index.ts:41-47` |
| `window.MiniCanvasPlugin.reload` | 重装 | 高：名字/形状都是字符串约定，宿主改了就静默失效 | `src/data/hotReload.ts:219-224` |
| `plugin-watch:` 前缀 | watch 工具与插件共享 | 中：无共享类型，两侧各写一份 | `src/data/hotReload.ts:526`；`packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs:10,32` |
| `localStorage['hot-reload:sources']` | 手填源持久化 | 低：插件私有键 | `src/data/hotReload.ts:162-213` |
| `EventSource('/api/kv/events')` | 无共享连接时自开 | 中：可能与宿主共享连接并存/重复 | `src/data/hotReload.ts:537-547` |
| `fetch('/plugin-catalog.json')` | 热重载反查产物 | 中：固定同源路径，跨源部署不适用 | `src/data/hotReload.ts:245-254,470-480` |
| `WebSocket(origin + '/')` | vite HMR | 中：只认 `/@vite/client` 风格，vite 版本/协议变化会断 | `src/data/hotReload.ts:328-372` |
| 页面隐藏 | 不断开 | 低：与宿主共享连接策略不同 | 本包未处理；宿主 `packages/ui/src/composables/kvEvents.ts:67-85` 会断 |

## 内部职责与风险

1. **数据层与壳分开**：`createHotReload` 可注入 `EventSource/WebSocket/reload/storage`，单测覆盖 SSE、vite、重连、持久化（`src/data/hotReload.test.ts:66-160`）。
2. **单例挂 window 是妥协**：多入口/控制台共享同一管理器有价值；但正常插件应经 `ctx.get('hot-reload')`，全局键只适合调试。
3. **全局 API 实际有两套名字**：成品壳挂 `MiniCanvasPlugin.reload`（`packages/ui/src/pluginReload.ts:163,362-368`），节点包 HMR 读 `MiniCanvas.reloadPlugin`（`packages/plugins/plugin-node-text/src/index.ts:15-18`）；后者在成品壳里取不到，这条分支会静默跳过。
+4. **KV 监听只覆盖产物门铃**：手填 SSE/vite 源仍保留；三条路径（KV 门铃、手填 SSE、vite HMR）并存，用户需要理解“为什么这条链接没反应”。
5. **卸载不摘 window 单例**：`apply` 只挂不摘，`ctx.effect` 只停 KV 订阅（`src/index.ts:52-53`）；重装后复用旧 manager，测试需手动清理。手填 SSE/vite 源在 `apply` 时并不会自动 `startSource`（`src/data/hotReload.ts:408-412`），只有用户操作或 `reconnect` 才连，这点与注释“登记几条链接”需区分。
6. **共享连接回退会造成第二条长连接**：宿主没有 `__miniCanvasKvEvents` 时自开 `EventSource`；若宿主晚于本插件挂共享，本插件不会切回共享。
7. **测试缺口**：`watchPluginChanges` 的共享/自开/卸载路径没有单测；现有 1 个测试文件只覆盖 `createHotReload` 的源连接。

## 单独装卸判断

- 不装：开发时改插件需手动 `window.MiniCanvasPlugin.reload` 或刷新；产品运行不受影响。
- 卸载：KV 订阅随 `ctx.effect` 停；`window.MiniCanvasHotReload` 仍持有旧 manager 与旧 sources；手填 SSE/vite 源也不会自动停（只有 KV 监听随 effect 回收）。
- 多标签页：每个页面一个单例；共享 SSE 由宿主统一，若宿主缺失则每页各开一条。

## 建议改法

1. **最小改动**：把 `plugin-watch:` 前缀与 `/api/kv/events` 路径提成共享常量（与 watch 工具、宿主 kvEvents 共用），消除字符串手抄。
2. **全局 API 收口**：导出一份 `PluginReloader` 类型声明，宿主挂 `window.MiniCanvasPlugin` 时同步使用；热重载插件只依赖该类型。
3. **单例清理**：给 `HotReload` 加 `dispose`，`apply` 的 `ctx.effect` 里在停订阅的同时从 `globalThis` 摘掉自己挂的键（仅当值仍是自己）。
4. **连接升级**：若启动时无共享连接，后续检测到 `__miniCanvasKvEvents` 出现时可切过去；至少补一条“共享连接晚到”的测试。
5. **测试补边界**：补 `watchPluginChanges` 的共享订阅、无共享自开、卸载停止、重复调用幂等四条测试。

## 待验证

- `MiniCanvas.reloadPlugin` 是否在某个非 ui 宿主中存在；当前仓库只看到节点包读取，未见挂载方。
- `ctx.effect` 是否会在插件热卸时也清理本包挂的 `globalThis` 键；从代码看不会。
- vite 源在 Vite 6/7 的 HMR 消息形状是否仍兼容；未做真机验证。

