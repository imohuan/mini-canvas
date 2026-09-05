# 02 - 最小可行方案：宿主(5199) 监听插件(530x) 文件变更 → reloadPlugin

> 目标场景：插件 `plugin-node-text` 自己 `vite`（530x）dev。宿主 canvas-core-v2（5199）页面要在插件改文件时收到通知，然后重新拉插件模块并 `reloadPlugin`。

## 0. 先看清 vite 给了什么、缺什么

| vite 现成能力 | 缺口 |
|---|---|
| watcher 监听文件变化 ✅ | 文件必须进**插件 dev 的模块图**才会推 ws 消息（lib/无 html 下模块图默认空） |
| HMR ws server + 全客户端广播 ✅ | 广播的是 **`update`/`full-reload`** 内部格式，路径是 dev URL |
| （无 html 时）ws server 照常起 ✅ | 浏览器跨源连入**必须带随机 token**（`?token=`，非公开） |
| —— | 没有任何公开的"文件变更 SSE/订阅端点" |

**所以 v8 现成"插件 dev server → 宿主"之间，没有一条开箱即用的通知链。** 缺的核心是两环：(A) 让文件变更**必然**触发事件并**能拿到 token/事件源**；(B) 把"文件变了"安全地透传给宿主。

## 1. 方案A（推荐，改动最小最稳）：插件里加一个自定义 vite 插件，暴露自己的 SSE/ws 变更端点

在插件 `vite.config.ts` 里注册一个小插件：

```ts
import type { Plugin } from 'vite'
import { EventEmitter } from 'node:events'

const emitter = new EventEmitter()
const CHANGED = 'changed'

export function fileChangeFeed(): Plugin {
  return {
    name: 'plugin-node-text:file-change-feed',
    configureServer(server) {
      // 直接把 vite 自己 chokidar 的结果喂给自定义事件（不依赖模块图）
      server.watcher.on('change', (file) => emitter.emit(CHANGED, String(file)))
      server.watcher.on('add', (file) => emitter.emit(CHANGED, String(file)))
      server.watcher.on('unlink', (file) => emitter.emit(CHANGED, String(file)))

      // 在 vite dev http server 上挂一个 SSE 端点，宿主可直接 fetch
      server.middlewares.use('/__plugin_changed', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        const on = (file: string) => res.write(`event: changed\ndata: ${JSON.stringify({ file })}\n\n`)
        emitter.on(CHANGED, on)
        req.on('close', () => emitter.off(CHANGED, on))
      })
    },
  }
}
```

宿主(5199)页面：

```js
const es = new EventSource('http://localhost:530x/__plugin_changed')   // SSE 天然跨源（服务端记得配 cors）
es.addEventListener('changed', (e) => {
  const { file } = JSON.parse(e.data)
  // 重新 import 插件模块（带时间戳绕过浏览器缓存），再 reloadPlugin
})
```

为什么推荐：**完全不碰 vite 模块图 / HMR 广播语义**，直接用 `server.watcher`（vite 已 watch root=插件 src），把"文件绝对路径"原样塞给宿主；宿主要重拉就重拉，不用解析 vite 的 update 内部格式。SSE 单向就够，浏览器原生支持，跨源只需在端点响应里加 CORS 头（vite dev 默认 `server.cors` 对非 localhost origin 开放，本机跨端口通常无碍，必要时显式加 `Access-Control-Allow-Origin`）。

> SSE（`/__plugin_changed`）是插件自己加的 HTTP 端点，**不是** vite 的 HMR 通道，绕开了 token。这是它比"宿主硬连 vite HMR ws"简单可靠的根本原因。

## 2. 方案B：复用 vite HMR ws（如果你真的想收 vite 的 update/full-reload）

想用 vite 原生的 update/full-reload 消息，需要同时解决三件事，成本明显更高：

1. **让文件进模块图**：让宿主真正 import 插件模块（例：宿主 `await import('http://localhost:530x/src/index.ts')` 一次，或插件 serve 一个含 `import.meta.hot.accept()` 的入口脚本被宿主加载）。没有这一步，src 改了 vite 只打 `[no modules matched]`，ws 不发消息。
2. **拿到 token**：浏览器连 `ws://localhost:530x/?token=<webSocketToken>`，token 每次启动随机。可让插件在 dev 时把 token 通过一个端点暴露，或在自定义插件里读 `server.config.webSocketToken` 后随某 HTTP 响应带给宿主。或者**把 token 校验关掉**（`config.legacy.skipWebSocketTokenCheck`，不推荐，有安全含义）。
3. **解析消息**：宿主收到 `update` 后 `path` 是 dev URL（root 内 `/src/index.ts`，root 外 `/@fs/...`），需据此 `fetch('http://localhost:530x'+path+'?t='+ts)` 拉新模块内容，再走 `reloadPlugin`；收到 `full-reload`（`path:"*"`）则整模块重拉。

这条链路把 vite 的 HMR 语义耦合进了宿主，且强依赖"进模块图 + accept 边界"都成立，坑最多。**除非你确实需要 vite 的边界级热替换，否则不建议。**

## 3. 方案C：不做通知，宿主轮询/依赖宿主自身的 watcher

若插件与宿主代码在**同一个 monorepo 且宿主 dev 的 watch 范围能覆盖插件 src**（或直接让宿主 dev server 的 root 指向仓库，watch 整个 monorepo），那宿主自己的 vite watcher 也会看到插件文件变化 → 走宿主模块图的 full-reload。这是最省事路径，前提是两边的 root/watch 配置允许——你的场景宿主 root=demo-web、插件在别处，多半要额外配 `server.watch` 范围或把插件路径纳入。可与方案A结合评估。

## 4. 建议

- 首选 **方案A**：自定义 vite 插件 + `server.watcher` + 一个 SSE 端点，改动小、不依赖 vite 内部语义、不碰 token、宿主侧只加 5 行 `EventSource`。
- 若将来需要宿主侧能拿到"到底哪个模块变了"的细粒度信息，也可让方案A把 `handleHotUpdate`/`hotUpdate` 插件里 vite 算好的 `options.modules` 一并塞进 SSE 消息（此时要求文件进模块图，代价见方案B第1点）。
- 记得：插件 dev server 起在 530x 时，宿主页面要访问它，需保证插件 dev `server.host` 监听宿主可达的地址（本机演示 `localhost` 即可）。

## 相关参考

- vite 官方：`/config/server-options`（`server.ws` 取代旧 `server.hmr` WebSocket 选项）、`/guide/api-hmr`
- 本仓库调研源码结论与行号：`README.md`、`01-mechanism.md`
