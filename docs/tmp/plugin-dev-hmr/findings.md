# 插件跨端口 dev 热重载 —— 落地实测结论(最终修正版)

> 日期 2026-09-04，`plugin-load-dev` 演示上端到端跑通。修正了上一版"原生 HMR 就能干、SSE 不可靠"的部分结论。

## 一句话
**让宿主自己重拉插件主模块 + reloadPlugin 是最可靠的热更通道**；但**重拉哪个 URL 是成败关键**。

## 铁证(Chrome 实测)
改 `TextContent.vue`(组件)或 `nodeTextPlugin.ts`(逻辑)，画布节点都实时更新，**页面不刷新**。
- 触发链：fileChangeFeed SSE(`/__plugin_changed`) → 宿主 `import('http://localhost:5311/src/nodeTextPlugin.ts?t=时间戳')` → `window.MiniCanvas.reloadPlugin('text',新模块)` → epoch++ → `.vue` 重建节点。

## 踩的坑

### 坑1(决定成败)：重拉【插件主模块】而非【入口 index.ts】
浏览器 ES 模块 map 按 URL 缓存：宿主首次 import 入口 index.ts 后，它的依赖 `nodeTextPlugin.ts`、`TextContent.vue` 各自只剩一份缓存记录。
- 改代码后 `import('/src/index.ts?t=123')`：index 是新 URL → 重拉，但它内部 `import "./nodeTextPlugin"` 仍命中模块 map 里**旧** nodeTextPlugin → 拿到旧实现。**入口重拉不可靠**。
- 改代码后 `import('/src/nodeTextPlugin.ts?t=123')`：nodeTextPlugin 是新 URL → 重拉重执行 → 它的 `import './TextContent.vue'` 取到的是**已被 vite HMR 更新过**的 TextContent 模块 → 组件与逻辑都新鲜。
**结论：重拉插件主模块(nodeTextPlugin.ts)直接 ?t= 重拉，.ts 和 .vue 都能热更。** 演示已这样实现。

### 坑2：跨端口双 vue / 双内核
- **vue：单份**(宿主与插件都 resolve 到 pnpm 同一真实路径 → 浏览器模块 map 同一 URL)。已证，控制台无"双 Vue"。
- **内核 provide/inject 令牌：跨端口 serve 的组件会"找不到"**。TextContent(5311 serve) import 的 HOST_KEY 从 5311 的 core 拿，宿主(5199) provide 的从 5199 的 core 拿 → 两个 core → 两个 Symbol → inject 失败。
  → 只影响跨端口 content 组件里 `inject(HOST_KEY)` 的交互(节点内编辑)，**不影响渲染与热更**。

### 坑3：`.vue` 单独改 靠 vite 原生 HMR 不冒泡到插件
@vitejs/plugin-vue 给 .vue 注入自 HMR，TextContent.vue 一改 vite 只原地 update 它，**不冒泡到 index 的 accept** → 原生 HMR 路径下 reloadPlugin 不触发。所以才让宿主自己经 SSE 重拉主模块(坑1方案)覆盖 .vue。

## 两个 Vue 告警的处理
- `Vue received a Component made reactive`：壳/内容组件不能放进 ref/reactive，装配时用 `markRaw(...)` 包住即消除。已修。
- `injection Symbol(canvas-v2-host) not found`：坑2 的内生现象，只影响节点内编辑写回。

## 最终拓扑(可跑，text 插件示例)
```
[插件 dev:5311]  pnpm dev:hmr  (vite --config vite.dev.config.ts)
  vue() + fileChangeFeed: server.watcher → SSE /__plugin_changed(推文件绝对路径)
[宿主 demo:5199]  /plugin-load-dev.html
  ① import('http://localhost:5311/src/index.ts') 首装 text(跨端口, 单 vue)
  ② EventSource('http://localhost:5311/__plugin_changed')：插件 src 任一支票变 → 重拉
     'http://localhost:5311/src/nodeTextPlugin.ts?t=时间戳' → reloadPlugin('text',新模块)
  ③ reloadPlugin 包一层: 计数 + epoch++ → .vue 重建节点 → 画布实时更新(ts/vue 都行), 不刷新
```

## 验证命令
- 插件 dev：`cd packages/plugins/plugin-node-text && node ../../canvas-core-v2/node_modules/vite/bin/vite.js --config vite.dev.config.ts`(5311)
- 宿主：`cd packages/canvas-core-v2 && node ./node_modules/vite/bin/vite.js`(5199)
- 页面：`http://localhost:5199/plugin-load-dev.html`
- 测试 121 全绿；内核 + text 插件 tsc 干净。
