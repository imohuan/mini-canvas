# 插件 build（lib 打独立 js）与宿主运行时加载 —— 完整配置

> 参照先例：`packages/prosemirror-editor-bundle/vite.config.ts`（lib formats es+umd、external、cssCodeSplit:false、dts）。
> 本包新栈：vite **8.0.16**、`@vitejs/plugin-vue` **^6.0.6**、ts **~6.0.2**。下面字段在 vite 8 均稳定可用。

## 1. 目标形态

- `pnpm build` 出一份**可独立加载**的 js（宿主 `import()` 或 `<script>` 拿到插件模块后 `installPlugin`）。
- 产物**不内嵌 vue/@vue-flow/core/@mini-canvas/canvas-core-v2**（由宿主提供）。
- 两态方案里，**给远程/第三方宿主加载、且强求单例，首选 UMD**（见 02 文档：UMD 经 window 全局拿宿主那份 vue）。
  若宿主是自家 bundler 单例装配（workspace import），ES 产物也可，但远程跨域场景 UMD+`<script>` 最省事、最不挑宿主。

### plugin-node-text/vite.config.ts —— lib build（UMD，生产可载）

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'MiniCanvasPluginNodeText',        // UMD 全局名（见下）
      formats: ['umd'],                        // 远程宿主首选；要 ESM 就 ['es'] 或 ['es','umd']
      fileName: () => 'plugin-node-text.js',
    },
    rollupOptions: {
      // ★ 这些绝不该打进产物：宿主只允许一份（vue 单例，见 02）
      external: ['vue', '@vue-flow/core', '@vue-flow/core/dist/style.css', '@vue-flow/core/dist/theme-default.css',
        '@mini-canvas/canvas-core-v2'],
      output: {
        globals: {  // UMD 从这些 window 全局取（见"运行时挂载"）
          vue: 'Vue',
          '@vue-flow/core': 'VueFlow',          // 需宿主先把单例 @vue-flow/core 挂到该全局
          '@mini-canvas/canvas-core-v2': 'MiniCanvasCore', // 若内核也 UMD 化则设此全局；否则此项要单独处理（见文末"内核怎么给"）
        },
      },
    },
    cssCodeSplit: false,   // .vue <style> 会打进单一 css；见"样式"节
    sourcemap: true,
  },
})
```

### 配套 script（package.json）

```jsonc
"scripts": {
  "dev": "vite",                                        // dev 入口（见 01 总览）
  "build": "vite build",
  "build:types": "tsc -p tsconfig.build.json --declaration --emitDeclarationOnly --outDir dist"
}
```
类型产物可参考 prosemirror 的 `vite-plugin-dts`，或纯 `tsc --emitDeclarationOnly`。若只要运行时 js、宿主也用 ts 从
workspace 源码拿类型，类型产物可暂缓。

## 2. 各个配置项为什么这么写

- **formats**：UMD = 一份自执行脚本，`<script src>` 就能跑，产物把 `export { nodeTextPlugin }` 挂到
  `MiniCanvasPluginNodeText.nodeTextPlugin`（因默认无 default export，命名导出在全局对象下）。ES = 标准 ESM，
  需 `<script type=module>` 或 `import()`；模块系统语义干净、tree-shake 友好，但要宿主支持 import map/解析到同一 vue。
  → 想"一份 `<script>` 就能 load"选 umd；宿主是自家 vite app 且能保证同 vue 时 es 也可。**建议默认 umd**。
- **fileName**：可固定名（如 `plugin-node-text.js`）供宿主 URL 写死；或按 format 出 `plugin-node-text.umd.js/.mjs`。
- **external**：核心三条——
  - `vue`：插件 .vue/.ts 里的 `import { … } from 'vue'` 全部外提。
  - `@vue-flow/core`：若 content 组件用到 `useVueFlow`/类型。它同时也在提供**画布上下文**，必须和宿主同实例（02 文档）。
    顺带把 `@vue-flow/core/dist/*.css` external 掉——那些 CSS 宿主 main 已引（demo-web/main.ts 引了 style.css + theme-default.css），
    再打一份会重复加载。
  - `@mini-canvas/canvas-core-v2`：插件逻辑 import `registerNodeType/PluginModule/HOST_KEY`，这些符号必须和宿主那棵
    Context 是同一个，否则 `registerNodeType(ctx,…)` 会把 content 注册进"另一份内核的 registry"，宿主渲染不到。→ 必须 external + 单例。
- **cssCodeSplit:false**：把插件 .vue 的 `<style>`/`<style scoped>` 合成**单份 css**（插件自带样式），避免每个组件一个异步
  chunk 需要额外按需加载。产物会出一个 `style.css`，**宿主 load 插件 js 后要自行把该 css 也挂上**（或用 `vite-plugin-css-injected-by-js`
  把 css 内联进 js，省去额外引 css）。scoped style 的 data-v-hash 哈希在编译期定死，与宿主运行无关，安全。
- **dts / 类型**：参照 prosemirror 用 `vite-plugin-dts`（include src，exclude demo）或 tsc。这里插件 tsconfig 已是
  `moduleResolution: Bundler + noEmit`，要出 dts 需一个 emitDeclarationOnly 的 build 版 tsconfig。

## 3. 宿主运行时怎么加载（含 CORS / 模块缓存）

### 3.1 UMD（推荐给远程宿主）
```html
<!-- 宿主先保证单例全局（这是单 vue 的钥匙，见 02） -->
<script src="https://unpkg.com/vue@3.5.34/dist/vue.global.prod.js"></script>
<script src="https://unpkg.com/@vue-flow/core@1.48.2/.../iife-or-umd.js"></script>  <!-- 挂 window.VueFlow -->
<!-- 再加载插件 -->
<script src="https://cdn.example/plugin-node-text.js"></script>
<script>
  // 产物把命名导出放全局 MiniCanvasPluginNodeText 上
  window.MiniCanvas.installPlugin(window.MiniCanvasPluginNodeText.nodeTextPlugin)
  // 或若想让全局也带个统一兜底，把模块对象直接交给 installPlugin
</script>
```
- **产物挂到的全局**：`MiniCanvasPluginNodeText`（= 配置里的 lib.name），插件 `nodeTextPlugin` 在其名下作 `.nodeTextPlugin`。
  因为 `index.ts` 没有 default export，`installPlugin` 收 `{ name, setup }`，所以给它 `.nodeTextPlugin` 那个对象即可。
- **window 全局冲突**：vue / @vue-flow/core / 内核的全局名需与产物 globals 完全一致（上面配 `Vue`/`VueFlow`/`MiniCanvasCore`）。
  若宿主本身是 vite app（非 script 引 vue），宿主得主动 `window.Vue = (await import('vue'))` 等，把运行时铺到这些全局——这才能喂饱 UMD 产物。

### 3.2 ES（宿主是自家 vite/rollup app，且保证解析到同一 vue）
```ts
// 宿主里
const mod = await import('https://cdn.example/plugin-node-text.mjs') // ES 产物
window.MiniCanvas.installPlugin(mod.nodeTextPlugin)
```
- 跨域 ESM 要 CORS：静态服务器/CND 返回 `Access-Control-Allow-Origin:*`。
- **模块缓存**：同 URL 第二次 `import()` 命中浏览器缓存，不会重拉（热更需改 URL query，如 `?t=${Date.now()}` 或改版本号）。
  `window.MiniCanvas.reloadPlugin('text', mod)` 语义是"先卸后装"，URL 还是同一份也 OK——但要在内容真正变过时用**新 URL** 才看得到。

### 3.3 dev 态宿主拉插件 dev server（跨端口）
- 插件 `vite.config` 需 `server.cors:true`，否则宿主 5199 → 插件 5301 跨源会被浏览器拦。
- **dev server 入口直接 import 能拿到 ESM 模块吗？——能**，vite dev 默认把一切入口当 ESM 服务，`import('http://localhost:5301/src/index.ts')`
  返回编译好的 ESM 模块命名空间，`mod.nodeTextPlugin` 可用（前提 CORS 开）。
- **但两个坑**：
  1. 插件 dev server 的产物里 `import 'vue'` 指向**它自己预构建的 vue**（`/node_modules/.vite/deps/vue.js`，相对它 root）→ 与宿主 vue 非同一份
     → **双 vue**（02 文档第 2 节，方案 C 的局限，难根治）。
  2. 若插件源码又 `import '@mini-canvas/canvas-core-v2'`，它解析到插件自己 node_modules 的该包 → 又一份内核，register 错 registry。
  → 故 dev 态强推 02 文档"方案 A/B"（宿主单一 dev server，workspace import / alias 到插件 src），别真去跨端口热拉。

### 3.4 关于 `/@vite/client`
只有**跑在 vite dev 里的入口模块**才会注入 `import '/@vite/client'`（HMR 基建）。宿主若动态 import 的是**插件 dev server 的入口**，
该模块自带对 `http://localhost:5301/@vite/client` 的引用——这本身能加载（同源插件 server），不是跨域问题，但意味着插件模块的整个
依赖闭环都依赖插件 dev server 活着。而 **build 出的 lib 产物不含 `/@vite/client`**（生产构建剥离），宿主 `<script>`/import 静态产物最干净。

## 4. 内核 `@mini-canvas/canvas-core-v2` 怎么给到远程插件

插件 UMD 把 `@mini-canvas/canvas-core-v2` external 了，运行时得从全局拿（`globals['@mini-canvas/canvas-core-v2']='MiniCanvasCore'`）。
要让这个全局存在，内核也得 UMD 化一份（prosemirror 先例即此类）：给 `canvas-core-v2` 加一个 `build` script + `vite.config.ts`
（lib es+umd，external:['vue','@vue-flow/core','pinia']），宿主先 `<script src="canvas-core-v2.umd.js">` 再 load 插件。
**但在本 repo 最现实的近路**：宿主 demo 本来就是 vite app、内核走 workspace import（单例已成立），那么
插件 content 需要内核符号时，直接让宿主自己 import 内核并把它注册成插件的**运行时来源**——即宿主在装插件前
`window.MiniCanvasCore = await import('@mini-canvas/canvas-core-v2')`，喂给 UMD 插件的 globals。两条路都对，看"宿主是不是自家 vite app"。

## 5. 验收清单（build 完成后照做）

1. `pnpm build` 出 `dist/plugin-node-text.js`(+style.css) 无 vue/@vue-flow/core/内核内嵌。
2. 起静态服务器：`<script src=vue.global.js>` + `<script src=插件.js>` + `window.MiniCanvas.installPlugin(window.MiniCanvasPluginNodeText.nodeTextPlugin)`。
3. 画布里能拖出 text/image 节点、content 可编辑（证明 HOST_KEY/provide/inject 通、content 组件正常渲染——即 vue 真单例）。
4. 浏览器 DevTools 确认 `import 'vue'` 只解析到一份（console 无 "different instance" / inject undefined 报错）。
5. （若走 dev）确认无双 vue：检查 Network 里 vue 只有一份 URL。
