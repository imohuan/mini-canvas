# ★ 极简实战：前后端一起写一个插件

> 这是全站最重要的一篇。30 分钟，你写出**两个真插件**（一个前端节点 + 一个后台接口），
> 让它们互相配合：前端节点上有个按钮，点了调后台接口，把返回的文字写进节点。
> 出现的每个 API 都有跳转链接，点了就到对应 API 页。

## 你会做出什么

- 前端：画布上多一种「留言卡」节点，卡片上有个「盖章」按钮。
- 后台：多一个接口 `GET /api/stamp/time`，返回服务器当前时间。
- 连起来：点按钮 → 调后台 → 把「盖于 2026-10-10 14:30」写进卡片。

## 0 · 跑环境（2 分钟）

仓库根目录执行：

```bash
pnpm install                                  # 第一次需要
pnpm -C packages/cloud-server serve           # 起后台（:8865，含画布界面）
```

浏览器自动打开 `http://127.0.0.1:8865/` 就是画布。云服务托管界面时，前端插件和后台接口**同源**，
不需要处理跨域。环境细节见 [本地开发环境](/start/dev-setup)。

## 1 · 前端：留言卡节点（10 分钟）

新建目录 `packages/plugins/plugin-stamp/`，三个文件。

### 文件 1：package.json

```json
// 文件：packages/plugins/plugin-stamp/package.json
// 格式：JSON —— 插件身份证；miniCanvas 段是画布认插件的关键
{
  "name": "@my/plugin-stamp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "留言卡",
    "description": "能盖时间章的留言卡（前后端配合演示）",
    "pluginName": "stamp",
    "builtin": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/canvas-render": "workspace:*"
  },
  "peerDependencies": { "vue": "^3.5.34" }
}
```

### 文件 2：卡片组件 StampContent.vue

```vue
<!-- 文件：packages/plugins/plugin-stamp/src/StampContent.vue -->
<!-- 格式：Vue 单文件组件 —— 节点卡片「里面」那一层 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { StampService } from './stampService'

// ① 壳注入的两个 props：id = 节点编号，data = 节点存的数据
const props = defineProps<{ id: string; data: { text?: string; stamp?: string } }>()
const { ctx } = useCanvasRender()
const stamping = ref(false)

// ② 点按钮：调后台接口 → 把结果写进节点数据
async function stamp() {
  if (stamping.value) return
  stamping.value = true
  try {
    // ③ 后台接口就是第 2 节在「后台插件」里注册的那条
    const res = await fetch('/api/stamp/time')
    const b = await res.json()
    // ④ 写数据只经服务一个门：进历史、可撤销、自动落盘
    ctx?.get<StampService>('stamp')?.stamp(props.id, '盖于 ' + b.time)
  } finally { stamping.value = false }
}
</script>

<template>
  <div class="stamp-card">
    <div class="text">{{ data.text || '（空）' }}</div>
    <div v-if="data.stamp" class="stamp">{{ data.stamp }}</div>
    <button class="act nodrag nopan nowheel" :disabled="stamping" @click="stamp">
      {{ stamping ? '盖章中…' : '盖时间章' }}
    </button>
  </div>
</template>

<style scoped>
.stamp-card { box-sizing: border-box; width: 100%; height: 100%; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.text { flex: 1; font-size: 14px; white-space: pre-wrap; overflow: hidden; }
.stamp { color: #c2410c; border: 1px dashed #c2410c; border-radius: 6px; padding: 2px 8px; font-size: 12px; align-self: flex-start; }
.act { align-self: flex-start; border: 1px solid #e2e2e3; border-radius: 6px; padding: 4px 10px; cursor: pointer; background: transparent; }
</style>
```

> `nodrag nopan nowheel` 三个类告诉画布：在这个按钮上按住鼠标，别拖卡片、别滚画布。
> 组件写数据的纪律见 [案例 1](/examples/first-node)：只调服务，不直接改 `props.data`。

### 文件 3：服务 + 插件本体

```ts
// 文件：packages/plugins/plugin-stamp/src/stampService.ts
// 格式：TypeScript 模块 —— 服务类：new 的时候自动以 'stamp' 名上架
import { Service, type Context } from '@mini-canvas/canvas-base'

/** 对外能力：别的插件/组件从这里调（类型增强后还能 ctx.stamp 直达） */
export interface StampService {
  stamp(id: string, text: string): void
}

export class StampServiceImpl extends Service implements StampService {
  constructor(ctx: Context) { super(ctx, 'stamp') }   // ① 构造即上架，卸载自动回收
  stamp(id: string, text: string): void {
    // ② 一律走 doc 服务写数据（进历史+落盘）；旧名字 nodeStore/graph/save 已并进 doc
    this.ctx.get('doc').updateNode(id, { data: { stamp: text } })
  }
}
```

```ts
// 文件：packages/plugins/plugin-stamp/src/index.ts
// 格式：TypeScript 模块 —— 插件入口（裸导出 name / inject / apply 三样）
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import StampContent from './StampContent.vue'
import { StampServiceImpl, type StampService } from './stampService'

export const name = 'stamp'
export const inject = ['doc'] as string[]        // ③ 硬依赖：doc 没就绪我就等着

/** 类型增强：让全画布 ctx.stamp 直达（只有类型提示作用，运行时走服务代理） */
declare module '@mini-canvas/canvas-data' {
  interface Context { stamp: StampService }
}

export function apply(ctx: Context): void {
  // ④ 上架服务（别的插件/组件 ctx.get('stamp') 可取，取不到是 undefined 不抛）
  new StampServiceImpl(ctx)

  // ⑤ 注册节点类型：数据形状 + 长什么样 + 怎么新建，一次搞定
  ctx.nodes.register({
    type: 'stamp',
    label: '留言卡',
    nameTemplate: '留言卡 {{ID}}',
    size: { w: 260, h: 160 },
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    in: StampContent,                            // 卡片内容组件（字段名必须是 in）
    create(position) {                           // 「新建」按下去走这里
      return ctx.get('doc').transaction('add-stamp', (tx) =>
        tx.createNode('stamp', position, { text: '写点什么…' }))
    },
  })
}

/** 兼容装配列表的出口 */
export const stampPlugin: PluginModule = { name, inject, apply }
```

### 把它装进画布

打开 `packages/ui/src/assembly.ts`（成品应用的插件清单），加两行：

```ts
// 文件：packages/ui/src/assembly.ts（节选）—— 顺序即装载顺序
import { stampPlugin } from '@my/plugin-stamp'   // ① import（包名 = 上面 package.json 的 name）
// …
export const APP_PLUGINS = [
  // …既有插件…
  stampPlugin,                                   // ② 加进清单
]
```

同时在 `packages/ui/package.json` 的 dependencies 里加 `"@my/plugin-stamp": "workspace:*"`。
重启 `pnpm -C packages/cloud-server serve`，画布左侧「新建节点」就多一项**留言卡**。

### 这一节用到的 API（点击直达）

- [`ctx.nodes.register` 全字段](/canvas-data/node-types)
- [`doc` 服务：transaction / updateNode](/services/doc)
- [`Service` 基类与 inject 硬依赖](/kernel/services)
- [`useCanvasRender` 渲染上下文](/canvas-render/render-context)

## 2 · 后台：盖章接口（8 分钟）

后台插件**不需要进装配清单** —— 丢一个 .js 文件进后台插件目录就行。
目录是数据根下的 `server-plugins/`（默认 `.mini-canvas/server-plugins/`，没有就建一个）。

### 文件：stamp-server-plugin.js

```js
// 文件：<数据根>/server-plugins/stamp-server-plugin.js
// 格式：JavaScript（自包含单文件 —— data: URL 加载，没有依赖解析，import 不了别的包）
// 位置：后台插件目录；服务启动时自动装载，运行期也可热装

// ① 后台插件和前端同构：裸导出 name / apply。ctx 上多出 routes/store/jobs/mcp/agent 五个插座
export const name = 'stamp-server'

export function apply(ctx) {
  // ② 注册一条 GET 路由。卸载这个插件，这条路由自动消失。
  ctx.routes.get('/api/stamp/time', (c) =>
    c.json({ ok: true, time: new Date().toLocaleString('zh-CN') }),
  )

  // ③ 顺手演示私有存储：每次盖章记一笔（卸载插件 = 数据一起清掉）
  const logs = ctx.store.namespace('stamp-logs')
  ctx.routes.post('/api/stamp/log', async (c) => {
    const body = await c.req.json()
    const n = ((await logs.get('count')) ?? 0) + 1
    await logs.set('count', n)
    await logs.set('log-' + n, body)
    return c.json({ ok: true, seq: n })
  })

  // ④ 定时任务：每 60 秒清一次超过 100 条的旧记录（演示 ctx.jobs）
  ctx.jobs.every(60_000, async () => {
    const n = (await logs.get('count')) ?? 0
    if (n > 100) await logs.set('count', 100)
  })
}
```

重启后台（或走热装接口），验证：

```bash
curl http://127.0.0.1:8865/api/stamp/time
# → {"ok":true,"time":"2026/10/10 14:30:22"}
```

### 这一节用到的 API（点击直达）

- [`ctx.routes`](/cloud-server/capabilities-routes) —— 同 path 先注册者优先、必须在 apply 同步注册
- [`ctx.store`](/cloud-server/capabilities-store) —— 插件私有持久化（卸载即清）
- [`ctx.jobs`](/cloud-server/capabilities-jobs) —— 定时任务（最小间隔 50ms、进程内不持久化）
- [后台插件系统总览](/cloud-server/server-plugins) —— 五种能力段与加载方式

## 3 · 连起来（2 分钟）

回到浏览器：拖一张**留言卡**出来，点「盖时间章」——
按钮调的 `/api/stamp/time` 就是第 2 节注册的后台接口；返回的时间写进卡片，
Ctrl+Z 能撤掉，刷新还在（落盘了）。再验证私有存储：

```bash
curl -X POST http://127.0.0.1:8865/api/stamp/log -H "content-type: application/json" -d '{"nodeId":"1","stamp":"盖于…"}'
# → {"ok":true,"seq":1}
```

## 你刚学会了什么

| 你写的 | 用的 API | 文档 |
| --- | --- | --- |
| 前端节点插件 | `ctx.nodes.register` / Service 上架 / `inject` | [案例 1](/examples/first-node) · [node-types](/canvas-data/node-types) · [kernel/services](/kernel/services) |
| content 组件 | `useCanvasRender` / props {id, data} | [渲染上下文](/canvas-render/render-context) |
| 后台路由 | `ctx.routes.get` | [routes](/cloud-server/capabilities-routes) |
| 后台存储 | `ctx.store.namespace` | [store](/cloud-server/capabilities-store) |
| 后台定时 | `ctx.jobs.every` | [jobs](/cloud-server/capabilities-jobs) |

## 下一步

- 想要更多前端花样（浮层 UI / 快捷键 / 配置面板 / 给别人提供服务）→ [示例](/examples/recipe-map) 8 个案例按需抄。
- 想深挖后台（给 AI 加工具 / 中间件 / 热装 NPM 插件）→ [后台插件系统](/cloud-server/server-plugins)。
- 手边常备 → [核心 API 总览](/core/) 与 [15 个内置服务](/services/)。
