# Vue 单例与运行时动态加载插件（最关键问题）

> 要回答：① host/插件各带一份 vue 会出什么问题；② lib external 掉 vue/vue-flow 是不是"正道"；
> ③ dev 态（插件 dev server 被 host import）会不会双 vue；④ 怎么避免。
> 结论先行：**唯一正确姿势是“浏览器里只存在一份 vue 运行时 + 一个 @vue-flow/core”**，
> 而且必须靠**模块解析落到同一份文件**来保证，光“external 掉 vue”不够。

## 0. 为什么必须单例（先讲清后果）

插件 UI 是 `.vue` content 组件（`TextContent.vue` / `ImageContent.vue`），经 `registerNodeType` 交进 `nodeRegistry`，
最终由宿主的 `<VueFlow>` + `BaseNode` 在**宿主那棵 Vue 应用**里 `component :is` 渲染（CanvasDemo 全程 `<VueFlow>` 包住、`provide(HOST_KEY…)`）。

如果宿主一份 vue、插件一份 vue，会产生三类破坏（都来自"两份 vue 运行时"）:

1. **`provide/inject` 断链**：content 组件 `inject(HOST_KEY)` 取宿主句柄。`inject` 用的是运行时里按组件实例关联的
   provide 表；content 若由另一份 vue 的 `createApp`/`defineComponent` 产物注册，`inject` 查不到宿主那份 vue 挂的
   provide，`hostRef` 为 `undefined` → 插件一开就崩（TextContent line 15 会 throw）。
2. **组件重复 / 渲染函数不认**：`defineComponent`、`resolveComponent`、`createVNode`、`isRef`/`reactive` 等符号若来自
   两份模块，宿主的 `component :is` 拿到的可能是"另一个 vue 的组件定义"，实例化/补丁走错函数，表现成组件不渲染、
   报"VNode created with a different instance"。
3. **`@vue-flow/core` 重复更致命**：CanvasDemo 把 `<VueFlow>` 挂进宿主 app，VueFlow 用 `provide`/`inject` 下发画布上下文
   （`useVueFlow` 内部 `inject(flowKey)`）。插件 content 里若 `import { useVueFlow } from '@vue-flow/core'` 拿到的是**另一份
   @vue-flow/core**，它的 `inject` 键/`provide` 实现和宿主挂的那份不是同一份 → `useVueFlow` 拿到 undefined / 拿错实例。
   **@vue-flow/core 本身也是"状态单例敏感"的库**（一个画布根 + provide 上下文），必须与宿主同源同实例。

> 所以"单例"不只是 vue，而是 **vue + @vue-flow/core + pinia 这套 Vue 生态运行时都要单例**。
> 凡是和 provide/inject、全局响应式、组件系统相关的库，都归到这一条。

## 1. lib 模式 external 掉 vue / @vue-flow/core 是不是正道？

**方向对，但只是必要条件，不是充分条件；而且要分 dev/build 两态看。** external 的作用是"打出来的产物里不内嵌
vue/@vue-flow/core，运行时去 import 宿主已有的那批"。光这样还差最后一步：**产物运行时 import 到的，
必须真的就是宿主加载的那一份 vue**。

- **ES 产物（formats:['es']）**：`import { ... } from 'vue'`。解析成宿主同一份的前提是**模块解析同 URL/同文件**
  （例如都裸 import 'vue'，且跑在同一个 import map 或同一 bundler 把 'vue' 解析到 node_modules 同一份 vue.mjs）。
  若插件产物是 `<script type=module>` + import map，只要宿主和插件用同一个 import map 把 'vue' 指向同一 URL → 单例成立。
  若插件是被宿主 bundler `import()`（如 vite dev 宿主），vite 会把两边 `'vue'` 都解析到宿主自己的 node_modules →
  也单例。**ES 单例的钥匙是"解析到同一份文件"**。
- **UMD/IIFE 产物（formats:['umd']）**：UMD 走 `globals`——vite 要求你在 `rollupOptions.output.globals` 里写
  `{ vue: 'Vue', '@vue-flow/core': 'VueFlow' /* 或其它全局名 */ }`，运行时产物从 `window.Vue` 取。**此时单例的钥匙是：
  宿主在插件脚本之前，先 `window.Vue = 自己的vue`、`window['@vue-flow/core']…= 自己的`**（或用 `<script>` 先引 vue 的 UMD 包）。
  vite 不会替你挂全局——**你不挂，产物就从 window.Vue 拿到 undefined → 直接崩**。

**结论**：external + 正确 globals/import 解析 = 正道；但必须补上"宿主真的提供那个被 external 出去的全局/模块源"。
UMD 走 window 全局，ES 走 import map / bundler 解析，两条路都成立，二选一并把配置对齐即可。

## 2. dev 态（插件 dev server 被宿主 import）会不会双 vue？

**会，如果什么都不做。** 这是最容易踩的坑，机制如下：

宿主 demo 在 **vite dev** 里跑（port 5199），它把 `'vue'` 解析到自己 node_modules 的 vue，并 `optimizeDeps.include:['vue']`
预构建成单份。宿主去 `import('http://localhost:5301/src/index.ts')` 拉**另一个 vite dev server（插件）**的模块：

- 插件 dev server 编译 `src/index.ts` 里的 `import ... from 'vue'` 时，**它按它自己的 node_modules 解析 'vue'**，
  返回 `'/node_modules/.vite/deps/vue.js'` 这种相对它自身 root 的预构建 URL。
- 宿主浏览器拿到的是 `http://localhost:5301/...` 上的模块 → **这是"另一个 vite dev 实例预构建的 vue"**，
  和宿主 5199 上那份 vue 是**两份不同模块实例** → 单例破裂 → 上面三类问题全来。

这就是为什么 dev 态必须专门处理（见第 3 节）。**dev 态不存在“宿主单 vue 源自动外溢给插件 dev server”这回事**，
两个 dev server 默认各 prebundle 各的 vue。

### 避免 dev 双 vue 的办法（三选一，按稳到不稳排）

**方案 A（最稳，推荐）：host 用 `vite dev + ssr.noExternal / resolve.dedupe` 让插件模块“并入宿主依赖图”。**
把插件 dev 入口当普通源码依赖：宿主这边能 `import('@mini-canvas/plugin-node-text')` 时，若想让其指向独立 dev server，
用一个 `resolve.alias` 把该包名指到 `http://localhost:5301/src/index.ts`——**但这跨 dev server，vite 8 对 alias 到 http 模块
的处理有限**。真正干净的变体其实是下面 B：

**方案 B（真正推荐，零双 vue）：别让插件“自起 server 且被 import”——改由宿主 vite dev 用 alias 把插件源码目录映射进来，**
`pnpm dev` 跑**宿主一个** dev server，插件改动靠宿主 dev server 的 HMR。即：
`CanvasDemo` 侧 `resolve.alias: { '@mini-canvas/plugin-node-text': '<repo>/packages/plugins/plugin-node-text/src/index.ts' }`
（pnpm workspace 里这通常已天然成立：宿主 devDeps 就 `workspace:*` 引了插件，`import '@mini-canvas/plugin-node-text'` 已解析到
插件 `src/index.ts`，且**同属宿主这一个 dev server → 与宿主共享同一份 vue 预构建 → 天然单例**）。
这就是**当前 CanvasDemo line 24-25 的现状**：两个插件是被宿主 dev server 直接 import 的，已是单例，HMR 走宿主。

> 所以如果“插件要单独 pnpm dev”的真实动机只是**想要独立地写/看插件 UI**，那更该给插件包加一个 `demo-web`（自己的 html+
> 一个最小 `<VueFlow>`+host）自己 dev 自己看，**不跟宿主串**，天然无双 vue 问题；宿主侧继续用 workspace import（现状）保持单例。
> 只有当诉求是“宿主运行时真实去拉一个正在热更的插件 dev server”时才需要方案 C 的处理。

**方案 C（真·宿主拉独立插件 dev server，需处理单例）：**
让插件 dev server 对 vue/@vue-flow/core 不做预构建而是**透传/别名到宿主的 URL** 是不现实的（两个端口间没法共享 node_modules
绝对路径给浏览器）。可行近似：
- 插件 dev server 侧 `server.cors:true`（让宿主能跨端口 import），并 `optimizeDeps.include`/`resolve.dedupe` 尽量让模块一致；
- 最省事的落地：**宿主仍用 workspace import（单例），插件 dev server 只作为“独立开发预览”用**，不去真被宿主 import。
真要在宿主里热更远程插件、又强求单 vue，最实际是**打包成 UMD 由宿主 global 提供 vue**（走 build 态方案，见 lib-build.md）——
dev 态的“远程双 vue”本质难根治，故推荐 A/B。

## 3. 内存/结构性结论

- **单例对象 = vue 运行时 + @vue-flow/core + pinia + HOST_KEY 用的那棵 Vue 应用**。
- **判断是否单例的标准 = 浏览器里各依赖是否解析到同一份模块文件（同一 URL/同一文件）**，而不是“是不是同版本”。
- 目录里同版本 ≠ 同文件：两个 dev server 各 prebundle 一份 vue，即使版本完全一致也是两个模块实例 → 照样破。
- 破法排序：dev 态首选“宿主一个 dev server 全包（workspace import / alias）”；远程热加载优先走 build 出的 **UMD + host 提供 window 全局**。
