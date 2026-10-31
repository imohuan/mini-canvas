
# 端到端可运行 Demo

**一句话定位**：**这一篇给你一个最小的、真能跑起来的画布应用 —— 三个文件（`index.html` / `main.ts` / `App.vue`）加一份 `vite.config.ts`，照抄就能在浏览器里看到画布。**

**它属于哪一档**：**渲染层的落地示例**。参照的真实装配是成品应用 `packages/ui/`（`src/App.vue` + `src/assembly.ts` + `src/main.ts`），本篇是把它削到最小。

## 它是什么

一个「最小可用」的画布应用需要四样东西：

| # | 需要什么 | 由谁给 |
| --- | --- | --- |
| 1 | 一个 Vue 应用挂在页面上 | 你自己（`createApp`） |
| 2 | 画布组件 `<CanvasHost>` | `@mini-canvas/canvas-render` |
| 3 | 「皮肤」插件（节点壳 / 边 / 背景） | `@mini-canvas/plugin-theme-default` |
| 4 | 至少一种业务节点 | `@mini-canvas/plugin-node-text`（或 image 等） |

外加两件**一定要做**的事：引入 VueFlow 的两份样式表、给画布容器一个确定的尺寸。

## 为什么需要它

第一次上手最容易卡在四个地方（这一篇就是为了替你踩掉）：

1. **忘了引 VueFlow 的样式** → 画布能渲染但线段错位、端口跑到角落；
2. **容器没有高度** → 画布高度 0，页面上什么都看不到（`CanvasHost` 自己不吃尺寸）；
3. **装配清单顺序给反了** → 没装主题插件时节点是「裸内容」（没有卡片壳、没有端口）；
4. **以为 `useCanvasRender()` 哪儿都能用** → 它只在渲染子树内有效，业务 UI 必须放 `<template #ui>`。

## 怎么用

### 一、目录长这样

```
canvas-app/
├── index.html          # 页面骨架：一个挂载点 #app，挂着 Vue 的入口脚本
├── package.json        # 依赖：vue / vite / @vitejs/plugin-vue / canvas-render / 两个插件包
├── vite.config.ts      # 关掉 VueFlow 相关包的预打包（workspace 源码要交给 vite 直接编译）
└── src/
    ├── main.ts         # 引样式 + createApp(App).mount('#app')
    ├── App.vue         # 一行 CanvasHost（含装配清单、存储、种子、事件）
    └── assembly.ts     # 可选：把「装了哪些插件 / 用什么存储 / 种子数据」单独放一份
```

（这一篇的例子没有单独落盘成示例目录 —— 上面的四个文件就是全部内容，照抄即可。）

### 二、`index.html`

```html
<!-- 文件：canvas-app/index.html
     格式：HTML（Vite 的入口页，位置在项目根目录）
     位置：它只干两件事：给个 #app 挂载点、引 src/main.ts -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mini-canvas 最小应用</title>
    <style>
      /* ① 画布要铺满整屏：html/body/#app 都必须有高度，否则画布高度是 0（什么都看不到） */
      html, body, #app { height: 100%; margin: 0; }
      * { box-sizing: border-box; }
    </style>
  </head>
  <body>
    <!-- ② 挂载点 -->
    <div id="app"></div>
    <!-- ③ 应用入口（Vite 会处理这个模块图） -->
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 三、`src/assembly.ts`（可选，但强烈建议）

```ts
// 文件：canvas-app/src/assembly.ts
// 格式：TypeScript 模块
// 位置：装配决定（装哪些插件 / 用什么存储 / 空画布塞什么）的唯一住址
import type { CanvasNode, StorageAdapter } from '@mini-canvas/canvas-data'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

// ① 顺序即装载顺序：先装「皮」（提供节点壳/边/背景/端口），再装业务节点
export const APP_PLUGINS = [themeDefaultPlugin, nodeTextPlugin]

// ② 存储后端：换 MemoryStorageAdapter 就是「刷新即丢」（试东西时很方便）
export function createStorage(): StorageAdapter {
  return new LocalStorageAdapter()
}

// ③ 只在「存储里从未保存过任何画布」时才会跑（用户删光了刷新不会复活）
export function seedDefaultCanvas(): CanvasNode[] {
  return [
    { id: 'welcome', type: 'text', position: { x: 160, y: 140 }, data: { text: '双击我编辑\n\n· 从两侧圆点拖出连线\n· 拖动节点可移动\n· 选中后按 Delete 删除' } },
  ]
}
```

### 四、`src/App.vue`

```vue
<!-- 文件：canvas-app/src/App.vue
     格式：Vue 单文件组件
     位置：应用装配层 —— 一行 CanvasHost 出画布，业务 UI 放 #ui 插槽 -->
<script setup lang="ts">
import { shallowRef } from 'vue'
import { CanvasHost, type CanvasHostHandle } from '@mini-canvas/canvas-render'
import { APP_PLUGINS, createStorage, seedDefaultCanvas } from './assembly'

const adapter = createStorage()             // ① 存储：只建一次（重建会换一份数据）
const host = shallowRef<CanvasHostHandle>()  // ② 宿主句柄：@ready 之后才有值

function onReady(h: CanvasHostHandle) {
  host.value = h
  // ③ 验证装配：控制台应看到 ['theme-default', 'text']（宿主自有的 canvas-base 被隐藏）
  console.log('已装插件：', h.ctx.listPlugins())
}

function addText() {
  // ④ 建节点走命令（快捷键 / 右键菜单 / 脚本都走同一个入口）
  host.value?.command.execute('command:create-node', { type: 'text', position: { x: 420, y: 140 } })
}

function undo() {
  host.value?.command.execute('command:undo')   // ⑤ 撤销：数据层自带，宿主已注册
}
</script>

<template>
  <!-- ⑥ 画布铺满：CanvasHost 自己不吃尺寸，谁给它容器谁负责大小 -->
  <div style="width: 100vw; height: 100vh">
    <CanvasHost
      :plugins="APP_PLUGINS"
      :adapter="adapter"
      :seed="seedDefaultCanvas"
      :dev="import.meta.env.DEV"
      window-key="MiniCanvas"
      @ready="onReady"
      @plugin-issue="(p) => console.warn('插件异常：', p.name, p.lifecycle)"
    >
      <!-- ⑦ 业务 UI 必须放 #ui：只有渲染子树内才拿得到 ctx -->
      <template #ui>
        <div class="demo-bar">
          <button @click="addText">加文本节点</button>
          <button @click="undo">撤销</button>
        </div>
      </template>
    </CanvasHost>
  </div>
</template>

<style scoped>
/* 小工具条：定位由自己负责（CanvasHost 不做布局） */
.demo-bar { position: absolute; left: 12px; top: 12px; display: flex; gap: 6px; z-index: 30; }
.demo-bar button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--ui-line, #e2e5ea); background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); cursor: pointer; }
.demo-bar button:hover { border-color: var(--ui-accent, #0891b2); }
</style>
```

### 五、`src/main.ts`

```ts
// 文件：canvas-app/src/main.ts
// 格式：TypeScript 模块（应用入口）
// 位置：把样式备齐、把应用挂到 #app —— 样式这步漏了画布「能显示但不对」
import { createApp } from 'vue'

// ① VueFlow 的两份样式必须由宿主自己引（canvas-render 刻意不 import CSS，免得非构建环境直接报错）
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import App from './App.vue'

// ② 挂载
createApp(App).mount('#app')
```

### 六、`vite.config.ts`（这一段最容易踩，照抄）

```ts
// 文件：canvas-app/vite.config.ts
// 格式：TypeScript 模块（Vite 配置）
// 位置：项目根目录 —— 让 vite 直接编译 workspace 源码包（不要预打包）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    // ① 这些包是 workspace 里的**源码**（未打包的 .ts/.vue）：必须排除预打包，
    //    否则 vite 会把它们当第三方依赖预构建，VueFlow 的单例 / 样式替换都可能出问题。
    //    真实对照：packages/ui/vite.config.ts 里有同名的一份更长清单。
    exclude: [
      '@mini-canvas/kernel',
      '@mini-canvas/canvas-data',
      '@mini-canvas/canvas-render',
      '@mini-canvas/plugin-theme-default',
      '@mini-canvas/plugin-node-text',
    ],
  },
})
```

```json
// 文件：canvas-app/package.json
// 格式：JSON（npm 包清单）
// 位置：项目根目录
{
  "name": "canvas-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/canvas-render": "workspace:*",
    "@mini-canvas/plugin-node-text": "workspace:*",
    "@mini-canvas/plugin-theme-default": "workspace:*",
    "@vue-flow/core": "^1.48.2",
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.6",
    "typescript": "~6.0.2",
    "vite": "^8.0.12"
  }
}
```

### 七、跑起来

```bash
pnpm install            # 在仓库根目录（workspace）装依赖
pnpm -C canvas-app dev  # 起开发服务，浏览器打开终端里打印的地址
```

页面上应该看到：**一张带网格背景的画布 + 一个写着文字的卡片（带两侧圆点端口）**。

### 八、演示：热装一个插件（不用改任何文件）

把下面这段贴进浏览器控制台，就多了一个「随机放一个文本节点」的插件，再卸掉它：

```js
// 片段：控制台里热装 / 热卸（window.MiniCanvas 由 window-key="MiniCanvas" 挂上）
const mod = {
  name: 'console-demo',
  inject: [],
  apply(ctx) {
    // register 的撤销随插件作用域自动回收，所以这里不用写清理
    ctx.commands.register({
      id: 'console-demo:add',
      title: '随机放一个文本节点',
      run() {
        const pos = { x: Math.round(Math.random() * 600) + 80, y: Math.round(Math.random() * 400) + 80 }
        ctx.get('doc').transaction('console-demo', (tx) => tx.createNode('text', pos, { text: '控制台加的' }))
        return true
      },
    })
  },
}

MiniCanvas.installPlugin(mod)      // ① 装上
MiniCanvas.listPlugins()           // ② → ['theme-default', 'text', 'console-demo']
MiniCanvas.getContext().get('canvas').runCommand('console-demo:add')   // ③ 跑一次
MiniCanvas.uninstallPlugin('console-demo')   // ④ 卸掉：命令也一起消失
```

### 九、对照：成品应用多做了什么

这个 demo 是**最小**版。真实成品应用（`packages/ui/`）在它基础上多了：

| 成品应用多出来的 | 在哪 |
| --- | --- |
| 24 个插件的装配清单（含分组注释与「为什么某个不冷启动」的理由） | `packages/ui/src/assembly.ts` |
| 应用外壳布局（顶栏 / 左下状态 / 底部 dock / 左右抽屉） | `packages/ui/src/components/CanvasShell.vue` |
| 设置面板 + 小地图 + Agent 面板的挂载点（都在 `#ui` 里） | `packages/ui/src/App.vue` |
| 主题配色 / 交互开关 / 外观参数接到设置面板 | `packages/ui/src/composables/ui.ts` |
| 快捷键、Esc 语义、离开画布前落盘 | 同上 + `App.vue` 的键盘处理 |

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/ui/src/App.vue` | 成品应用的真实装配（本 demo 的「完整版」对照） |
| `packages/ui/src/assembly.ts` | 真实装配清单 `APP_PLUGINS`（含每个插件的取舍理由） |
| `packages/ui/src/main.ts` | 真实入口：先挂共享全局（供外部 UMD 插件取依赖），再 mount |
| `packages/ui/index.html` | 真实 `index.html`：默认挂 `class="dark"` 避免首屏亮→暗闪 |
| `packages/ui/vite.config.ts` | 真实的 `optimizeDeps.exclude` 长清单（照它抄最稳） |
| `packages/docs/public/examples/**` | 本仓库其他文档页附带的示例源码（同一套「照抄能跑」的约定） |

## 完整例子

上面那份四个文件就是完整例子，直接照抄即可。

再补一个**常被问到的变体**：不想要 Vue，只要一个能在控制台里玩的画布（Node 环境）：

```ts
// 文件：canvas-app/scripts/headless.ts
// 格式：TypeScript 模块（Node 运行，tsx scripts/headless.ts）
// 位置：无浏览器的「画布逻辑实验场」—— 数据层能跑，但画面相关的服务用不了
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

const { host, exposeToWindow } = await createMiniCanvasHost({
  adapter: new MemoryStorageAdapter(),
  coldPlugins: [nodeTextPlugin],   // 注意：没装主题插件也没关系，Node 里根本没有画面
  dev: true,
})
exposeToWindow('MiniCanvas')

const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
text.addTextNode({ x: 0, y: 0 })
console.log(host.doc.getNodes())        // ① 数据层完全可用（建节点 / 撤销 / 落盘）
console.log(host.ctx.get('view')?.getViewport())   // ② 视口服务在（但后端没挂，读的是默认值）
await host.save.flush()
host.stop()
```

## 常见坑

1. **忘了引 VueFlow 的 CSS**。两个文件都要：`@vue-flow/core/dist/style.css` 与 `@vue-flow/core/dist/theme-default.css`。漏了不会报错，但边跑偏、端口位置错、光标不对。
2. **容器没有尺寸**。`CanvasHost` 的根是 `width:100%; height:100%` —— 它的父容器必须有确定高度。最简单是照抄 `html, body, #app { height: 100% }` + 外层 `height: 100vh`。
3. **`vite.config.ts` 没排除 workspace 源码包**。这些包是未编译的 `.ts` / `.vue` 源码，放着让 vite 预打包会出现「依赖解析怪问题 / 两份实例」。照抄 `optimizeDeps.exclude` 清单最省事。
4. **`adapter` 每次渲染都重建**。`new LocalStorageAdapter()` 要放在 `setup` 里**只跑一次**的位置（或模块级），不能在模板 / `computed` 里建 —— 否则每次重建都会换一份存储，用户看到「刚存的没了」。
5. **业务 UI 放错位置**。放进 `<template #ui>` 才在渲染子树里；放外面会导致里面的组件调 `useCanvasRender()` 时抛错。
6. **Node 环境看不到画面不是坏了**。`createMiniCanvasHost` 在 Node 里能跑，但「渲染」这件事本身要浏览器：`view` 的视口后端只有 `<CanvasSurface>` 挂载后才接上，DOM 锚点也只有那时才有。
