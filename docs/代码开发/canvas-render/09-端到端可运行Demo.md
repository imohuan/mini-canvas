# canvas-render 开发手册 · 端到端可运行 Demo（照着抄就能跑）

> 来源：真实插件装配示例 `packages/plugins/plugin-theme-default/demo-web/App.vue` + `main.ts`、
> `packages/canvas-render/src/host/CanvasHost.vue`，插件 `packages/plugins/plugin-*` 的 src。

这段是"开发者照着抄就能跑"的最小完整样板：**内核 Context + text/image 插件 + render 宿主（CanvasHost）** 组装成一个能渲染、能编辑、能连边、能撤销的 Vue 画布应用。

**跑起来的环境要求**：本 demo 属于 Vue 3 + TS 项目。`canvas-render` 的 peerDependencies 是 `@vue-flow/core ^1.48.2` 与 `vue ^3.5.34`；需要 `@vue-flow/core/dist/style.css` 和 `theme-default.css`。用 Vite 开发时，你的工程要能解析 workspace 里的 `@mini-canvas/*` 包（monorepo + 别名/pnpm workspace 即可）。

---

## 文件骨架（4 个文件）

```
你的 Vue 工程/
├─ index.html
├─ src/
│  ├─ main.ts        # 创建 Vue app，引 VueFlow 样式，挂 App
│  ├─ App.vue        # 一个 <CanvasHost> 完成画布渲染 + 业务 UI（#ui）
│  └─ vite.config.ts # （示例，把 @mini-canvas/* 别名指到源码）
```

---

## 1) main.ts —— 入口 + 样式

```ts
import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'        // VueFlow 基础样式（必需）
import '@vue-flow/core/dist/theme-default.css' // VueFlow 默认主题
import App from './App.vue'

createApp(App).mount('#app')
```

> `@vue-flow/core` 的样式必须全局引入一次；否则画布连拖拽/背景都不会正常显示。

---

## 2) App.vue —— 关键：一个 <CanvasHost> 全搞定

```vue
<script setup lang="ts">
// —— 插件装配：默认主题 + 两个业务节点 + 画布命令 ——
import { ref } from 'vue'
import { CanvasHost } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render' // CanvasHostHandle 由 canvas-render 导出
import type { CanvasNode } from '@mini-canvas/canvas-core-v2'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'

// 首次(存储空)的默认画布：一个文本节点 + 一个图片节点，方便你立刻看到"壳/内容/连线"三件套
const sampleImg = () =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ddd6fe"/><text x="60" y="90" font-family="sans-serif" fill="#7c3aed">示例图片节点</text></svg>`,
  )

function seedDefault(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 160, y: 160 }, data: { text: '双击我输入文字' } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: sampleImg() } },
  ]
}

// CanvasHost 的 ref 实例：boot 后经 .host / .api / .manager 驱动业务（见下）
const canvasEl = ref<{ host: CanvasHostHandle | undefined } | null>(null)
const ready = ref(false)

function onContextMenu(ev: { kind: 'node' | 'pane'; clientX: number; clientY: number; nodeId?: string }) {
  // 例子：在画布空白处右键，弹一个"加文本节点"——经 host 句柄/命令建节点
  if (ev.kind === 'pane') {
    canvasEl.value?.host?.command.execute('command:create-node', {
      type: 'text', position: { x: ev.clientX - 80, y: ev.clientY - 40 },
    })
  }
}
</script>

<template>
  <div class="app-root">
    <div v-if="ready" class="toolbar">
      <span class="hint">拖圆点连边 · Delete 删选中 · Ctrl+Z 撤销 · 空白处右键加节点</span>
      <!-- #ui 区内的内容在 CanvasSurface provide 作用域内，能 useCanvasRender 读 ctx（见第 3 节） -->
    </div>

    <CanvasHost
      ref="canvasEl"
      class="canvas-area"
      :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]"
      :seed="seedDefault"
      window-key="MiniCanvasDemo"
      @ready="ready = true"
      @context-menu="onContextMenu"
    />
  </div>
</template>

<style scoped>
.app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}
.toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid #ddd;
  background: #fff;
  z-index: 10;
}
.canvas-area {
  flex: 1;
  min-height: 0;   /* 关键：父容器是 flex 列，画布要能收缩，否则高度塌陷 */
}
</style>
```

要点逐条解释：
1. `plugins` 数组顺序即装载序：`themeDefaultPlugin`（默认皮肤：节点壳 BaseNode / 连线 CustomEdge / 背景 / 设置面板）排最前，再是业务节点，最后是命令。**缺 themeDefaultPlugin 就没皮肤、节点没壳**。
2. `seed` 只在首次（存储空）跑，之后刷新自动恢复。
3. `window-key` 把 `api` 挂到 `window.MiniCanvasDemo`（开发期 HMR / console 调试）。
4. CanvasHost 会占满父容器，父级用 flex 布局在外层套 toolbar 即可（见上模板）。画布 `.canvas-area` 要给 `min-height: 0` 才会在 flex 列里正确收缩。
5. `@ready` 之后才 `ready=true` 显示 toolbar。

---

## 3) 进阶 A：怎么在 #ui 里加"建节点"按钮（读 ctx）

把业务 UI（toolbar / 按钮 / 设置 dock）放进 CanvasHost 的 `#ui` 具名插槽里，就能让子组件 `useCanvasRender()` 拿 ctx，再经插件服务或命令建节点。

先写一个放在 `#ui` 里的子组件 `AddButton.vue`（任何 `.vue` 都可以，因为它渲染在 CanvasSurface 的 provide 作用域内）：

```vue
<!-- AddButton.vue -->
<script setup lang="ts">
import { useCanvasRender } from '@mini-canvas/canvas-render'
const { ctx } = useCanvasRender()   // 裸 ctx，已就绪

function addText() {
  // 经统一命令建节点 → 可撤销、自动落盘、自动刷渲染态
  ctx.command.execute('command:create-node', { type: 'text', position: { x: 120, y: 120 } })
}
</script>
<template>
  <button @click="addText">加一个文本节点</button>
</template>
```

再在 App 里放进 `#ui`（`plugins` 数组沿用第 2 节那几个已装配的插件即可；`notePlugin` 是下面第 4 节才新增的，这里先用已有的）：
```vue
<template>
  <CanvasHost :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]">
    <template #ui>
      <AddButton />   <!-- 这里渲染 → useCanvasRender 可用 -->
    </template>
  </CanvasHost>
</template>
```

> 注意：**必须放在 CanvasHost 的 `#ui`（或内容槽）内**。放在 CanvasHost 顶层同级的组件（其 setup 在宿主 provide 作用域之外跑）`useCanvasRender()` 会抛"缺少渲染上下文"。

---

## 4) 进阶 B：自定义一个业务节点插件（含 content 组件）

想加一种你自己的节点？三步：写 content 组件 → 写插件逻辑注册 type + content → 加进 plugins。下面以"note 便签节点"为例。

**4.1 content 组件 `NoteContent.vue`**
```vue
<script setup lang="ts">
// content 组件只 import render 层，不反向依赖宿主
import { ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
const props = defineProps<{ id: string; data: { text?: string } }>()
const { ctx } = useCanvasRender()
function noteService() { return ctx.note }   // 类型来自插件 declare module 增强
const shown = ref(props.data.text ?? '')
function commit(e: FocusEvent) {
  const el = e.target as HTMLTextAreaElement
  if (el.value !== shown.value) { shown.value = el.value; noteService().edit(props.id, el.value) }
}
</script>
<template>
  <div class="note-node">
    <textarea :value="shown" placeholder="便签…" @blur="commit" />
  </div>
</template>
```

**4.2 插件逻辑 `notePlugin.ts`**
```ts
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import NoteContent from './NoteContent.vue'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context { note: NoteService }
}
export class NoteService extends Service {
  constructor(ctx: Context) { super(ctx, 'note') }
  add(position: { x: number; y: number }): string {
    const ns = this.ctx.get<NodeStoreService>('nodeStore')
    const id = ns.addNode('note', position)
    ns.updateNodeData(id, { text: '新便签' })
    return id
  }
  edit(id: string, text: string): void {
    const ns = this.ctx.get<NodeStoreService>('nodeStore')
    this.ctx.get<SaveService>('save').set('graph', ns.getNodes(), 'canvas')
    ns.updateNodeData(id, { text })
  }
}
export const name = 'note'
export const inject = ['nodeStore', 'save'] as string[]
export function apply(ctx: Context) {
  const s = new NoteService(ctx)          // 构造即上架 'note' 服务
  ctx.nodes.register({                    // 数据 + 展示同时注册（自动回收）
    type: 'note', label: '便签', size: { w: 240, h: 160 },
    content: NoteContent,
    create: (pos) => s.add(pos),
  })
}
export const notePlugin: PluginModule = { name, inject, apply }
```

**4.3 加进 CanvasHost**
```ts
:plugins="[themeDefaultPlugin, notePlugin, nodeTextPlugin, canvasCommandsPlugin]"
```
节点 type 会出现在 nodeStore 注册表；nodeShell（BaseNode）会把 `NoteContent` 渲染进卡片；建节点可用 `ctx.command.execute('command:create-node', { type:'note', position })` 或直接 `host.ctx.get('note').add(...)`。

---

## 5) 进阶 C：想用 localStorage 持久化

CanvasHost 缺省 `adapter` 是内存（刷新即丢）。传 `LocalStorageAdapter`：

```ts
import { CanvasHost } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-core-v2'

<CanvasHost :plugins="[...]" :adapter="new LocalStorageAdapter()" :seed="seedDefault" />
```

> `LocalStorageAdapter` 从内核 `@mini-canvas/canvas-core-v2` 导出（见 services/storage/localStorageAdapter）。存图 key：节点 `graph`、边独立 `graph-edges`（GRAPH_EDGES_KEY），作用域 `canvas`。

---

## 6) 进阶 D：SettingsHost + 设置弹窗

theme-default 已把 `settingsPanel` 赢家（PluginSettingsDialog）注册好，也把连线/背景 config 登记进了 settings。你在 `#ui` 里放个开关控制设置面板显示即可：

```vue
<script setup>
import { ref } from 'vue'
import { CanvasHost, SettingsHost } from '@mini-canvas/canvas-render'
const settingsOpen = ref(false)
</script>

<template>
  <CanvasHost :plugins="[...]">
    <template #ui>
      <button @click="settingsOpen = !settingsOpen">设置</button>
      <!-- 弹窗默认皮由 theme-default 提供（Teleport 到 body，这里只要 v-if 控制显隐） -->
      <SettingsHost v-if="settingsOpen" empty-hint="暂无设置面板" />
    </template>
  </CanvasHost>
</template>
```

---

## 常见问题速查

- **画布空白 / 节点无卡片**：多半漏了 VueFlow 两个 css，或 `plugins` 里没 themeDefaultPlugin。
- **改 data 画布不刷新**：别手动改 nodes 数组；改内核 `nodeStore`（CanvasHost 已订阅自动重灌）。
- **节点没连接 Handle / 没标题**：那是 nodeShell（BaseNode）提供的，确保 theme-default 在最前且被装载。
- **想要更多节点/边数据操作**：看 `host` 上的 `nodeStore/edgeStore/selection/history/command/nodeFactory`（CanvasHost `@ready` / ref 的 `.host`，或 `createMiniCanvasHost` 返回）。
- **组件 `useCanvasRender()` 报错"缺少渲染上下文"**：把它放进 CanvasHost 的 `#ui`/内容槽内，别放 CanvasHost 顶层同级。
