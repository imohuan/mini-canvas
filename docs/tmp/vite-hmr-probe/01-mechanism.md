# 01 - vite 8.0.16 dev HMR 机制详解（源码佐证）

> 引用的行号基于 `dist/node/chunks/node.js`（服务端，35109 行）与 `dist/client/client.mjs`（客户端，1271 行）。版本 8.0.16。文中 `F` 指服务端 chunk 文件，`C` 指 client.mjs。

## 1. 传输通道：纯 WebSocket，无 SSE

`grep -in "EventSource\|event-stream\|text/event-stream\|sse"` 在 `dist/node/chunks/node.js`、`dist/client/client.mjs` **零命中** → 8.0.16 的 dev HMR **只有 WebSocket** 一种实现，没有 SSE 代码路径。（早前某些版本在配置文档层面给过 `ws.type` 的可扩展位，但本版本实际实现只有 `ws`。）

客户端建立连接（`C` 行 854-875）：

```js
const socketProtocol = __HMR_PROTOCOL__ || (importMetaUrl.protocol === "https:" ? "wss" : "ws");
const socketHost = `${__HMR_HOSTNAME__ || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${__HMR_BASE__}`;
...
createConnection: () => new WebSocket(`${socketProtocol}://${socketHost}?token=${wsToken}`, "vite-hmr")
```

- `__HMR_*`、`wsToken` 这些占位符是 **index.html 被 vite 转换时，由 `/@vite/client` 的注入逻辑替换成真实值**的。所以：**只有页面确实加载了 `/@vite/client`（vite 在 html transform 阶段自动注入）才会有正确的连接参数**。手写第三方页面若想连，得自己拿到 token（见下）。

### 服务端默认挂载（复用 dev http server）

`createWebSocketServer`（`F` 行 16261）核心选择：

```js
const hmr = isObject(config.server.hmr) && config.server.hmr; // 新版配置走 server.ws
const hmrServer = hmr && hmr.server;
const hmrPort = hmr && hmr.port;
const wsServer = hmrServer || (!hmrPort || hmrPort === config.server.port) && server; // 默认：复用 http server
const port = hmrPort || 24678;
```

- **默认（未配 `server.ws.port`）**：`wsServer = server`（dev 的 http server），在该 http server 的 `upgrade` 事件上监听：
  ```js
  if (["vite-hmr","vite-ping"].includes(protocol) && parsedUrl.pathname === hmrBase) handleUpgrade(...)
  ```
  `hmrBase = config.base`（默认 `/`），即 ws 升级路径就是 **`/`（首页）**。所以连接 URL 是 `ws://host:port/?token=…`（query 不参与 pathname 匹配）。
- **若设了独立 `server.ws.port`**：才起独立 `wsHttpServer` 监听 `hmrPort`（`wsHttpServer.listen(port, host)`），路径同样为 `config.base`。
- 只要 `config.server.ws !== false`，HMR ws server 就建立。默认开启。

### 握手鉴权 `shouldHandle`（跨源 token 门槛，关键）

`F` 行 16261 内：

```js
const shouldHandle = (req) => {
  if (req.headers["sec-websocket-protocol"] === "vite-ping") return true;
  if (allowedHosts !== true && !isHostAllowed(req.headers.host, allowedHosts)) return false;
  if (config.legacy?.skipWebSocketTokenCheck) return true;
  if (req.headers.origin) return hasValidToken(config, new URL(`http://example.com${req.url}`));
  return true;   // ← 无 Origin 则放行（典型非浏览器 ws 客户端）
};
```

- **浏览器发起的任何 ws 升级请求都带 `Origin` 头**（同源也带）。因此对浏览器来说 **token 校验是强制路径**：URL 里 `?token=` 必须等于服务端随机生成的 `config.webSocketToken`，否则 upgrade 被拒，客户端连不上。
- token 来源（`F` 行 34719）：`webSocketToken: Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url")` —— **每次 dev server 启动随机生成**。
- 只有**非浏览器 ws 客户端**（Node `ws`、curl 之类，不带 Origin）才走 `return true` 免 token。
- `hasValidToken` 用 `crypto.timingSafeEqual` 比对 `?token=` 与 `config.webSocketToken`（`F` 行 16257）。
- host 白名单：`allowedHosts` 默认 `[]`，但官方文档说明 localhost / `*.localhost` / IP 默认放行，跨本机/跨端口访问同一 host（如都连 `localhost`/`127.0.0.1`）不受限。

### 连接成功后：全局广播

握手成功 `wss.on("connection")` 后立刻 `socket.send({type:"connected"})`。真正的广播在 `normalizedHotChannel.send`：

```js
send(payload) {
  if ((payload.type === "error" || payload.type === "full-reload") && !wss.clients.size) {
    bufferedMessage = payload; return;   // 无客户端时暂存，来客户端补发
  }
  const stringified = JSON.stringify(payload);
  wss.clients.forEach((client) => { if (client.readyState === 1) client.send(stringified); });  // ← 全客户端无差别广播
}
```

**结论：没有"按模块路径订阅"机制。HMR 消息一发就是对当前所有 ws 连接者广播。** 谁连上、谁就收到一切（只要还满足握手时的 host/token 门槛）。

## 2. 文件变化 → 何时真正推送？模块图是决定性闸门

### watcher → handleHMRUpdate

`F` 行 26390：watcher 回调里 `if (serverConfig.hmr !== false) await handleHMRUpdate(type, file, server);`

`handleHMRUpdate`（`F` 行 26792）在跑完各插件的 `hotUpdate`/`handleHotUpdate` 后，对每个 environment 执行 `hmr(environment)`：

```js
async function hmr(environment) {
  const { options, error } = hotMap.get(environment);
  if (error) throw error;
  if (!options.modules.length) {                     // ★ 模块图为空
    if (file.endsWith(".html") && environment.name === "client") {
      // 只有 .html 文件强制全刷新
      environment.hot.send({ type: "full-reload", path: ... });
    } else {
      debugHmr?.(`(${environment.name}) [no modules matched] ${...shortFile}`);  // ★★ 非 html 且无模块 → 什么都不发
    }
    return;
  }
  updateModules(environment, shortFile, options.modules, timestamp);  // 有模块 → 走 update/full-reload 决策
}
```

而 `options.modules` 来自模块图：

```js
const mods = new Set(environment.moduleGraph.getModulesByFile(file));
```

模块图（`F` 行 23721 `getModulesByFile`）是从 `fileToModulesMap` 查的，**只有当某模块被 vite dev 真正 transform/加载过**（即有客户端请求了该模块 URL）才会被登记进这个 map。**加载过 = 进了模块图 = 它成为某个"已建立页面/脚本模块图"的一部分**。

> 注意：`hotUpdate` 插件（vue 插件等）能在这里向 `options.modules` **注入模块**，从而把"没被直接 import 的文件"也纳入变更响应。因此 `.vue` 单文件组件即使不直接 import，只要它的父链上有人 import 过 SFC，plugin-vue 的 `hotUpdate` 仍会把它补进 modules → 触发 update。这解释了为什么 vue 项目"改了没在跑的页面组件也会 HMR"的边界行为——取决于插件是否往 options.modules 里塞。

### updateModules：发 update 还是 full-reload

`F` 行 26990 `updateModules`：对每个匹配模块沿依赖链找热边界（`accept()` 声明）：

- 找到可接受边界 → 发 `{ type: "update", updates: [{ type:"js-update", path: <模块devURL>, acceptedPath:<热边界URL>, timestamp }] }`
- 走到死端（某模块没被 accept 且无边界兜底）→ `needFullReload` → 发 `{ type: "full-reload", triggeredBy: <绝对路径>, path: "*" }`
- 模块全是 css/asset、无 js 变更时也归为 full-reload/css-update。

客户端收到 `update` 后对 `js-update` 用 `import(base + path + ?t=timestamp)` 重拉模块；收到 `full-reload` 则 `location.reload()`（`C` 行 1005-1027, 1040）。**客户端只认这几种消息，且只被动响应——它不主动去 poll 文件。**

### 消息里模块路径的形态

`update.path` = `normalizeHmrUrl(boundary.url)`，即模块的 **dev URL**：
- root 目录内的文件 → `/src/index.ts` 这种相对 root 的路径；
- root 之外（monorepo 里 root 设为宿主/插件自己的 src 而文件在别处）→ 以 `/@fs/绝对路径` 前缀出现（`F` 行 29686 解析 `/@fs/`）。
`full-reload.triggeredBy` 是磁盘绝对路径，`path` 通常 `"*"`。

## 3. 对"插件无 html / lib 模式 dev server"的直接影响

插件 `dev: vite` 起的就是普通 dev server（`build.lib` 只影响 build 输出，不影响 dev）。dev server 行为与有无 html **基本无关**，它总会：

1. 起 watcher（chokidar watch `root`，默认 `config.root`=vite 启动目录=插件目录）→ 监听插件 src 变化 ✅
2. 起 HMR ws server（默认复用 http server，`/` 路径）✅
3. 但**模块图为空**（没有页面/脚本请求过 `/src/index.ts`）→ `handleHMRUpdate` 对 src 文件变更走 `[no modules matched]`，**不发任何 ws 消息** ❌

所以"设 html 入口"真正改变的是：**html 会被 vite 转换、自动注入 `/@vite/client` 并建 ws 连接，且 html 里 import 的模块会进模块图**。二者共同解决了"进模块图"这个闸门。但 html 不是唯一手段——**任何能让宿主真去 import 插件模块的机制**（宿主页面动态 `import('http://插件:530x/src/index.ts')`，或插件 serve 一个轻量 loader 脚本被宿主 import）都能让它进模块图。

## 4. 结论小结

- 通道：WebSocket，非 SSE（8.0.16 无 SSE 实现）。
- 默认 ws 复用 dev http server，路径 = base（默认 `/`），握手协议 `vite-hmr`。
- 广播：无差别全客户端广播，无模块路径订阅过滤。
- 推送闸门：文件必须已进模块图（被某客户端 import/加载过，或 hotUpdate 插件注入）。lib/无 html 模式下模块图为空 → 不推。
- 外部跨端口连入的门槛：浏览器连接需正确 `?token=`（每次启动随机）；host 需在 allowedHosts（默认 localhost/IP 放行）。
- 最小可行方案见 `02-minimal-solution.md`。
