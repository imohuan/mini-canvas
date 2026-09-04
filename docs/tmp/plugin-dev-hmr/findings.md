# 插件跨端口 dev 热重载 —— 最终方案(纯 vite 官方 HMR API)

> 日期 2026-09-04。`plugin-load-dev` 演示端到端跑通。**完全用 vite 自带 HMR(import.meta.hot.accept + handleHotUpdate)实现，没有自建 SSE/轮询/手写 ?t= 重拉。**

## 一句话
宿主跨端口 import 插件 dev 模块时，vite 自动让宿主页面成为该 dev server 的 HMR 客户端；
插件用 `import.meta.hot.accept` 收通知 → `window.MiniCanvas.reloadPlugin` 就完成热更。只差一环：让**改 .vue 深层组件也能冒泡到插件入口的 accept**，用 dev 端的 `handleHotUpdate` 补上。

## 机制(三段全官方 API)
```
① 宿主页面  import('http://localhost:5311/src/index.ts')
   → vite 给该模块注入 5311 的 /@vite/client(token 随模块注入) → 宿主页面成为 5311 的 HMR 客户端
② 插件 src/index.ts  import.meta.hot.accept(self)   // 客户端收原生 HMR
   → 收到通知后调 window.MiniCanvas.reloadPlugin('text', 新模块)  // 重卸旧装新
③ dev server 端(handleHotUpdate)   // 补最后一环
   插件 src 任一支票变更时，把入口 index.ts 模块塞进本次热更受影响集合 → 必触发 ② 的 accept
   → 改 .ts(逻辑) 或 .vue(组件) 都让插件整树热更
```

## 为什么需要 handleHotUpdate(关键坑)
@vitejs/plugin-vue 给每个 .vue 注入了**自己的 self-accept**。当只改 TextContent.vue(深层组件)时，
vite 在该 .vue 就地热更、**不再向上冒泡**到插件 index.ts 的 accept → 若不处理，改 .vue 插件不会 reload。
→ 在 dev 配置里用官方 `handleHotUpdate(ctx)`：检测到插件 src 变更时，把入口模块也 push 进
  `ctx.modules`(受影响集合)，强制 index 本轮也被更新 → 它的 accept 必触发。实测改 .vue/.ts 都热更。

## 实现位置
- `packages/plugins/plugin-node-text/vite.dev.config.ts`：`forcePluginEntryHotUpdate()`(handleHotUpdate)。
- `packages/plugins/plugin-node-text/src/index.ts`：`import.meta.hot.accept((mod)=>reloadPlugin)`。
- `packages/canvas-core-v2/demo-web/plugin-load-dev.{ts,html}` + `-app.vue`：宿主演示。

## 已验证(Chrome，控制台连续=页面没刷新)
- 改 `TextContent.vue`(组件)：`hot updated /src/TextContent.vue` → `reloadPlugin` → 画布实时变。
- 改 `nodeTextPlugin.ts`(逻辑)：同上生效。

## 仍存在的独立问题(非热更，另记)
- `injection Symbol(canvas-v2-host) not found`：跨端口 serve 的 content 组件 import 的 HOST_KEY
  来自插件侧 core，宿主 provide 的来自宿主侧 core → 两个不同 Symbol 匹配不上。**只影响节点内编辑
  写回，不影响渲染与热更。** 跨端口不同源无法靠模块 URL 去重，属该模型内生限制。

## 验证命令
- 插件 dev：`cd packages/plugins/plugin-node-text && node ../../canvas-core-v2/node_modules/vite/bin/vite.js --config vite.dev.config.ts`(5311)
- 宿主：`cd packages/canvas-core-v2 && node ./node_modules/vite/bin/vite.js`(5199)
- 页面：`http://localhost:5199/plugin-load-dev.html`
- 测试 121 全绿；内核 + text 插件 tsc 干净。
