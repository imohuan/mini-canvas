# 插件跨端口 dev 热重载 —— 落地实测结论

> 日期 2026-09-04，在 `plugin-load-dev` 演示上端到端跑通。修正了 docs/tmp/vite-hmr-probe 里"推荐 SSE 重拉"的方向。

## 一句话

**原生 vite HMR 就能跨端口热更，不用自建 SSE 重拉**。宿主跨端口 `import` 插件 dev 模块(index.ts)时，vite 给该模块注入它自己 dev server 的 `/@vite/client`(token 随模块注入)→ 宿主页面自动成为插件 dev server 的 HMR 客户端。插件 src/index.ts 里的 `import.meta.hot.accept(...)` 收到原生 HMR 通知 → 调 `window.MiniCanvas.reloadPlugin`，就是完整的"改文件→宿主热更"链路，页面不刷新。

## 实测铁证(Chrome)
- 宿主 5199 跨端口装 text 插件 dev 模块(5311)，改 `nodeTextPlugin.ts` 里默认 text → 画布节点实时变成新文案，**页面没刷新**、控制台连续(无 reconnect)。
- 改 `index.ts`(accept 代码本身)会触发整页 reload(不可避免，属改"热更入口"本身)。
- SSE(`fileChangeFeed`/`/__plugin_changed`)仍可作"文件变了"的人肉可读提示，但**不要用它重拉模块**——见坑 1。

## 踩的坑(架构决策依据)

### 坑1：SSE 用 `import(入口?t=时间戳)` 重拉是"脏"的 —— 浏览器 ES 模块缓存
同一文档里，**同一模块 URL 只取一次、只执行一次**(模块 map 按 URL 去重)。宿主首次 import `/src/index.ts` 后，浏览器模块 map 里已有 `/src/nodeTextPlugin.ts`、`/src/TextContent.vue` 各一份。
改 nodeTextPlugin.ts 后 `import('/src/index.ts?t=123')`：index 是新 URL → 重拉重执行，但它内部 `import "./nodeTextPlugin"` 仍命中模块 map 里**旧** nodeTextPlugin → 拿到旧实现。
**证据**：`import(index?t=)` 得旧 text；`import(nodeTextPlugin.ts?t=)` 得新 text。
→ 结论：**SSE 重拉入口不可靠**，要靠 vite 原生 HMR(vite 在模块图内做真正的原地替换 + 缓存失效)。这也是为什么不依赖 SSE 做重拉、而交给原生 HMR。

### 坑2：跨端口双 vue / 双内核 会怎样
- **vue：单份**。宿主与插件都 resolve `vue` 到 pnpm 同一真实路径(`.pnpm/vue@3.5.38_...`)，插件 dev 的 `.vue` `import 'vue'` 和宿主拿同一物理文件 → 浏览器模块 map 命中同一 URL → 单 vue，无双 vue 警告。**不用 alias**。
- **内核 provide/inject 令牌：会"找不到"**。TextContent(5311 serve) `import HOST_KEY` 从 5311 的 `/@fs/core` 拿，宿主 DevHmrCanvas(5199 serve) provide 的 HOST_KEY 从 5199 的 `/@fs/core` 拿 → 两个 core 实例 → 两个不同 Symbol → inject 找不到。
  → 影响：跨端口 serve 的 content 组件里 `inject(HOST_KEY)` 拿不到宿主(编辑写回会抛"宿主未就绪")。**显示不受影响**(content 只读 props 渲染)，只影响依赖 inject 拿宿主 ctx 的交互。此为该跨端口模型的内生限制(不同源无法共享模块实例)。

### 坑3：`.vue` 单独改 不自动热更(插件"一次自描述注册"模型)
- @vitejs/plugin-vue 给每个 .vue 注入了自 HMR，TextContent.vue 一改，vite 只对 TextContent 做原地 update，**不冒泡到 index.ts 的 accept** → reloadPlugin 不触发 → 画布上已注册的 content 仍是旧组件。
- 修法方向：让 nodeTextPlugin.ts 这种"逻辑被 accept 覆盖的模块"作为边界(改它或其上游 .vue 会经它冒泡)。实测改 `nodeTextPlugin.ts`(逻辑)能热更；**只改被它 import 的 TextContent.vue 则不动**，除非同时动 nodeTextPlugin.ts(凑个冒泡)或走别路。
- 已把 index.ts 的 HMR 改成"自 accept(不带依赖数组)"，让 index 成为整棵子树的 HMR 边界；逻辑改动已实测热更。.vue 视觉微调属已知缺口。

## 最终拓扑(可跑，text 插件示例)
```
[插件 dev:5311]  pnpm dev:hmr  (vite --config vite.dev.config.ts)
  vite.dev.config.ts: vue() + fileChangeFeed(SSE /__plugin_changed 仅提示)  , root 无 html(宿主直接 import 源码)
[宿主 demo:5199]  /plugin-load-dev.html
  ① 宿主 import('http://localhost:5311/src/index.ts') 首装 text(跨端口,单 vue)
  ② 插件 src/index.ts 有 import.meta.hot.accept(自) → 原生 HMR → window.MiniCanvas.reloadPlugin('text',新模块)
  ③ 宿主把 reloadPlugin 包一层: 计数 + epoch++ → .vue 重建节点 → 画布显示新实现, 页面不刷新
```

## 验证命令
- 插件 dev：`cd packages/plugins/plugin-node-text && node ../../canvas-core-v2/node_modules/vite/bin/vite.js --config vite.dev.config.ts`(5311)
- 宿主：`cd packages/canvas-core-v2 && node ./node_modules/vite/bin/vite.js`(5199)
- 页面：`http://localhost:5199/plugin-load-dev.html`
- 测试 121 全绿；内核 + text 插件 tsc 干净。
