# canvas-render 开发手册 · 端到端可运行 Demo（照着抄就能跑）

> 来源：真实可跑样板 `packages/ui/src/App.vue` + `packages/ui/src/assembly.ts`（21 个插件装配），
> 轻量预览样板 `packages/plugins/plugin-theme-default/demo-web/App.vue` + `main.ts`（只装默认皮 + 一个示例节点类型，用来单独看壳/边/背景），
> 以及 `packages/canvas-render/src/host/CanvasHost.vue` 与各插件 `packages/plugins/plugin-*/src`。

这段是"开发者照着抄就能跑"的完整样板：**数据层 + text/image 插件 + 渲染宿主（CanvasHost）** 组装成一个能渲染、能编辑、能连边、能撤销的 Vue 画布应用。

**跑起来的环境要求**：Vue 3 + TS 项目。`canvas-render` 的 peerDependencies 是 `@vue-flow/core ^1.48.2` 与 `vue ^3.5.34`；需要 `@vue-flow/core/dist/style.css` 和 `theme-default.css`。用 Vite 开发时，你的工程要能解析 workspace 里的 `@mini-canvas/*` 包（monorepo + pnpm workspace 即可）。

> 最省事的跑法：直接跑仓库自带的成品应用 —— `pnpm -C packages/ui dev`，开 **http://localhost:5288**。
> 它的源码就是本节第 2、3 部分的放大版（21 个插件装配见 `packages/ui/src/assembly.ts` 的 `APP_PLUGINS`）。

---

## 文件骨架（3 个文件）

```
你的 Vue 工程/
├─ index.html
├─ vite.config.ts # 把 @mini-canvas/* 指到 workspace 源码（见下）
└─ src/
   ├─ main.ts     # 创建 Vue app，引 VueFlow 样式，挂 App
   └─ App.vue     # 一个 <CanvasHost> 完成画布渲染 + 业务 UI（#ui）
```

---

## 1) main.ts —— 入口 + 样式

```ts
import { createApp } from 'vue'
import '@vue-flow/core/dist/style.css'         // VueFlow 基础样式（必需）
import '@vue-flow/core/dist/theme-default.css' // VueFlow 默认主题
import App from './App.vue'

createApp(App).mount('#app')
```

> `@vue-flow/core` 的样式必须全局引入一次；否则画布连拖拽/背景都不会正常显示。

---

## 2) App.vue —— 关键：一个 <CanvasHost> 全搞定

```vue
<script setup lang="ts">
// —— 插件装配：默认皮肤 + 两个业务节点 ——
import { ref } from 'vue'
import { CanvasHost } from '@mini-canvas/canvas-render'
import type { CanvasHostHandle } from '@mini-canvas/canvas-render'  // 宿主句柄由 canvas-render 导出
import type { CanvasNode } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

// 首次(存储空)的默认画布：一个文本节点 + 一个图片节点，方便立刻看到"壳/内容/连线"三件套
const sampleImg = () =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<rect width="320" height="180" fill="#ddd6fe"/>' +
      '<text x="60" y="90" font-family="sans-serif" fill="#7c3aed">示例图片节点</text>' +
    '</svg>',
  )

function seedDefault(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 160, y: 160 }, data: { text: '双击我输入文字' } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: sampleImg() } },
  ]
}

// CanvasHost 的 ref 实例：boot 后经 .host / .api / .manager 驱动业务
const canvasEl = ref<InstanceType<typeof CanvasHost> | null>(null)
const ready = ref(false)

/**
 * 开发态开关：**必须显式传给 CanvasHost**。
 * canvas-render 是独立 workspace 包，它自己读 import.meta.env 拿不到 vite 的替换，所以这一层传下去。
 * 缺省 false = 生产语义（能力包 needs 缺项时不抛错、只 warn）。上线时这一项会自然变成 false。
 */
const DEV = import.meta.env.DEV

function onContextMenu(ev: { kind: 'node' | 'pane' | 'edge'; clientX: number; clientY: number; nodeId?: string }) {
  // 例子：在空白处右键 → 弹一个"加文本节点"（经宿主命令建节点，可撤销、自动落盘）
  if (ev.kind === 'pane') {
    canvasEl.value?.host?.command.execute('command:create-node', {
      type: 'text', position: { x: 120, y: 120 },
    })
  }
}
</script>

<template>
  <div class="app-root">
    <div v-if="ready" class="toolbar">
      <span class="hint">拖圆点连边 · Delete 删选中 · Ctrl+Z 撤销 · 空白处右键加节点</span>
      <!-- #ui 区内的内容在 CanvasSurface 的 provide 作用域内，能 useCanvasRender 读 ctx（见第 4 节） -->
    </div>

    <CanvasHost
      ref="canvasEl"
      class="canvas-area"
      :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin]"
      :seed="seedDefault"
      :dev="DEV"
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

1. `plugins` 数组顺序即装载序：`themeDefaultPlugin`（默认皮肤：节点壳 BaseNode / 连线 CustomEdge / 背景 / 设置面板）排最前，再是业务节点。**缺 themeDefaultPlugin 就没皮肤、节点没壳**。
2. `seed` 只在首次（存储从没保存过）跑，之后刷新自动恢复。
3. `:dev` 把开发态语义传进 `ctx.isDev`（不传 = 生产语义）。
4. `window-key` 把 `api` 挂到 `window.MiniCanvasDemo`（开发期 HMR / console 调试）。
5. CanvasHost 会占满父容器，父级用 flex 布局在外层套 toolbar 即可。画布 `.canvas-area` 要给 `min-height: 0` 才会在 flex 列里正确收缩。
6. 画布通用命令（建节点 / 删选中 / 撤销 / 重做）由数据层自带、宿主 boot 时默认注册，**不需要额外装插件**。所以 `@ready` 之后你就能用 `host.command.execute('command:create-node', …)`。

---

## 3) 想让画布持久化到 localStorage

CanvasHost 缺省 `adapter` 是内存（刷新即丢）。传 `LocalStorageAdapter` 即可：

```vue
<script setup lang="ts">
import { CanvasHost } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

const adapter = new LocalStorageAdapter()
const plugins = [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin]
</script>

<template>
  <CanvasHost :plugins="plugins" :adapter="adapter" window-key="MiniCanvasDemo" />
</template>
```

> `LocalStorageAdapter` 从 `@mini-canvas/canvas-data` 导出（`storage/localStorageAdapter`）。存图 key：节点 `graph`、边独立 `graph-edges`、视口 `graph-viewport`，作用域都是 `canvas`。

---

## 4) 进阶 A：怎么在 #ui 里加"建节点"按钮（读 ctx）

把业务 UI（工具栏 / 按钮 / 设置面板）放进 CanvasHost 的 `#ui` 具名插槽里，就能让子组件 `useCanvasRender()` 拿 ctx，再经服务或命令建节点。

先写一个放在 `#ui` 里的子组件 `AddButton.vue`（任何 `.vue` 都可以，因为它渲染在 CanvasSurface 的 provide 作用域内）：

```vue
<!-- AddButton.vue -->
<script setup lang="ts">
import { useCanvasRender } from '@mini-canvas/canvas-render'
const { ctx } = useCanvasRender()   // 裸 ctx，已就绪

function addText() {
  // 经统一命令建节点 → 可撤销、自动落盘、自动刷渲染态
  ctx.get<{ execute(id: string, ...p: unknown[]): unknown }>('command')
    .execute('command:create-node', { type: 'text', position: { x: 120, y: 120 } })
}
</script>

<template>
  <button @click="addText">加一个文本节点</button>
</template>
```

再在 App 里放进 `#ui`：

```vue
<template>
  <CanvasHost :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin]">
    <template #ui>
      <AddButton />   <!-- 这里渲染 → useCanvasRender 可用 -->
    </template>
  </CanvasHost>
</template>
```

> 注意：**必须放在 CanvasHost 的 `#ui`（或默认内容槽）内**。放在 CanvasHost 顶层同级的组件（其 setup 在宿主 provide 作用域之外跑）调 `useCanvasRender()` 会抛"缺少渲染上下文"。

---

## 5) 进阶 B：自定义一个业务节点插件（含 content 组件）

想加一种你自己的节点？三步：写 content 组件 → 写插件逻辑注册 type + 区域组件 → 加进 plugins。下面以"note 便签节点"为例。

**5.1 content 组件 `NoteContent.vue`**

```vue
<script setup lang="ts">
// content 组件只 import render 层，不反向依赖宿主
import { ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { NoteService } from './notePlugin'

const props = defineProps<{ id: string; data: { text?: string } }>()
const { ctx } = useCanvasRender()
function noteService() { return ctx.get<NoteService>('note') }

const shown = ref(props.data.text ?? '')
watch(() => props.data.text, (next) => { shown.value = typeof next === 'string' ? next : '' })

function commit(e: FocusEvent) {
  const el = e.target as HTMLTextAreaElement
  if (el.value !== shown.value) { shown.value = el.value; noteService().edit(props.id, el.value) }
}
</script>

<template>
  <div class="note-node">
    <textarea :value="shown" class="nodrag nopan nowheel" placeholder="便签…" @blur="commit" />
  </div>
</template>
```

**5.2 插件逻辑 `notePlugin.ts`**

```ts
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import NoteContent from './NoteContent.vue'

declare module '@mini-canvas/canvas-data' {
  interface Context { note: NoteService }
}

export class NoteService extends Service {
  constructor(ctx: Context) { super(ctx, 'note') }
  /** 内部统一走 doc 门面（唯一写入口：进历史 + 调度落盘），不直改 nodeStore/save */
  private doc(): DocService { return this.ctx.get<DocService>('doc') }
  add(position: { x: number; y: number }): string {
    return this.doc().createNode('note', position, { text: '新便签' })
  }
  edit(id: string, text: string): void {
    this.doc().updateNode(id, { data: { text } })   // 改节点自动进历史 + 调度落盘
  }
}

export const name = 'note'
export const inject = ['doc'] as string[]   // 硬依赖：数据走 doc

export function apply(ctx: Context) {
  const s = new NoteService(ctx)          // 构造即上架 'note' 服务（随插件 scope 回收）
  ctx.nodes.register({                    // 数据 + 展示一次给全（自动回收）
    type: 'note', label: '便签', size: { w: 240, h: 160 },
    in: NoteContent,                      // 区域词 in = 卡片内部（老字段 content 已下线，写它是类型错误/运行时抛错）
    create: (pos) => s.add(pos),
  })
}

export const notePlugin: PluginModule = { name, inject, apply }
```

**5.3 加进 CanvasHost**

```ts
:plugins="[themeDefaultPlugin, notePlugin, nodeTextPlugin]"
```

节点 type 会出现在 `ctx.get('doc').types` 里；nodeShell（BaseNode）会把 `NoteContent` 渲染进卡片；建节点可用
`ctx.get('command').execute('command:create-node', { type:'note', position })`，或直接 `ctx.get('note').add(...)`。

---

## 6) 进阶 C：设置面板

theme-default 已把 `settingsPanel` 槽的默认赢家（`PluginSettingsDialog`）注册好，也把连线/背景/端口等 config 登记进了 settings。你在 `#ui` 里放个开关控制设置面板显隐即可：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { CanvasHost, SettingsHost } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'

const settingsOpen = ref(false)
const plugins = [themeDefaultPlugin]
</script>

<template>
  <CanvasHost :plugins="plugins">
    <template #ui>
      <button @click="settingsOpen = !settingsOpen">设置</button>
      <!-- 弹窗默认皮由 theme-default 提供（`SettingsHost` 读 settingsPanel 槽赢家并喂 settings） -->
      <SettingsHost v-if="settingsOpen" empty-hint="暂无设置面板" />
    </template>
  </CanvasHost>
</template>
```

面板自身负责"值变了刷新控件"，`SettingsHost` 只负责读赢家 + 传 settings 源（详见《06》《07》）。

---

## 7) vite.config.ts 片段（把 @mini-canvas/* 指到源码）

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // monorepo 里用 pnpm workspace 时通常不需要别名（包名可直接解析）；
    // 想指到源码热改，就按需加别名，例如：
    alias: {
      // '@mini-canvas/canvas-render': '/abs/path/packages/canvas-render/src/index.ts',
    },
  },
})
```

---

## 常见问题速查

- **画布空白 / 节点无卡片**：多半漏了 VueFlow 两个 css，或 `plugins` 里没 `themeDefaultPlugin`。
- **改 data 画布不刷新**：别手动改 nodes 数组；经 `ctx.get('doc')` 改节点（唯一写入口，CanvasHost 已订阅自动重灌）。
- **节点没连接 Handle / 没标题**：那是 nodeShell（BaseNode）提供的，确保 theme-default 被装载且没被更小 order 的插件顶掉。
- **想要更多节点/边数据操作**：看 `host` 上的 `doc`（节点 + 边 + 事务/撤销一个门面）与 `selection/command/nodeFactory`（CanvasHost `@ready` / ref 的 `.host`，或 `createMiniCanvasHost` 返回）。
  > 老服务名 `nodeStore/edgeStore/graph/history` **已下线**（`ctx.get` 取不到），改用 `doc`；那四个实例仍挂在 `host` 句柄上，可直接 `host.nodeStore.getNodes()` 这样读。
- **组件 `useCanvasRender()` 报错"缺少渲染上下文"**：把它放进 CanvasHost 的 `#ui`/默认内容槽内，别放 CanvasHost 顶层同级。
- **Needs 缺项在开发时抛错、上线却只 warn**：那是 `:dev` 在起作用。开发态由 `import.meta.env.DEV` 传入，生产语义下缺项只 warn 不抛——这是有意设计（生产不能因为缺一个能力就白屏）。
