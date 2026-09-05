# 7 · 进入画布（端到端）

> 目标：把第 1–6 篇学的一口气串起来，写一个**真画布插件**——
> 能点出来一种节点 + 可配置 + 上服务 + 注册命令，在画布 UI 里真正工作。
> 这是最后一步：你已经能给画布加"自己的东西"了。

## 一句话

前面每篇讲一件能力；这一篇把它们**收进一个插件**。它注册一种节点（能放到画布上、能编辑）、
声明可配置项（面板能调）、上一项服务（给节点内容或别的插件用）、加一条命令（能一键调）。
真写出来你会发现：**没有一行"内核怎么渲染"的代码**——你只管在 `apply(ctx)` 里声明，
宿主自动把节点画出来、把面板长出来。

## 先看仓库里"生产级"的端到端插件长啥样

- `plugin-node-text`：节点（`ctx.nodes.register`，带 `content: TextContent.vue` + `create`）+
  服务（`ctx.inject('text', …)`）。节点内容组件用 `ctx.get('text')` 调服务写回并落盘。
- `plugin-theme-default`：`Config` schema（第 5 篇）+ 顶替三块主题皮（`nodeShell/edge/background`）。
- `plugin-canvas-commands`：一组命令（删/建/撤销/重做），`ctx.get` 用宿主服务。

你的插件就是把这几样**混在一个文件里**。下面写一个全新的"便签 sticker"节点插件示范怎么混。

## 写一个端到端画布插件：便签节点

新建 `packages/canvas-core-v2/demo-web/stickerPlugin.ts`，**照抄成这段**。
它同时做到：注册一种节点（有长相、能建）+ 一个 Config + 一项服务 + 一条命令。

```ts
import { defineComponent, h, type PropType } from 'vue'
import type { Context, ConfigSchema } from '@mini-canvas/canvas-base'
import type { NodeStoreService } from '@mini-canvas/canvas-core-v2'

export const name = 'sticker'
export const inject = [] as string[]

/** 可配置项：便签的默认文案 */
export const Config: ConfigSchema = {
  placeholder: { type: 'string', default: '便签', label: '占位文案', group: '便签' },
  sticky:      { type: 'boolean', default: true, label: '便签感', group: '便签' },
}

/** apply 收到的 config 类型（从 schema 推导，保证与默认值一致） */
export interface StickerConfig { placeholder: string; sticky: boolean }

export function apply(ctx: Context, config: StickerConfig) {
  const nodeStore = ctx.get<NodeStoreService>('nodeStore') // 宿主上架的节点数据服务

  // ① 注册节点：数据(type/label/尺寸) + 展示(content) + 建节点(create)
  //     content 用 defineComponent+h 内联(不必另开 .vue)；节点组件会收到 { id, data } props
  const StickerContent = defineComponent({
    props: {
      id: String,
      data: { type: Object as PropType<{ text?: string }>, default: () => ({}) },
    },
    setup(props) {
      return () =>
        h('div', {
          style: {
            background: config.sticky === false ? '#fff7ed' : '#fef9c3', // 用 config 控制长相
            border: '1px solid #facc15', borderRadius: '4px',
            height: '100%', padding: '8px 10px', fontSize: '14px', color: '#713f12',
          },
        }, String(props.data?.text ?? config.placeholder ?? '便签'))
    },
  })

  ctx.nodes.register({
    type: 'sticker',
    label: '便签',
    size: { w: 180, h: 100 },
    content: StickerContent,
    create(position) {
      const id = nodeStore.addNode('sticker', position)
      nodeStore.updateNodeData(id, { text: config?.placeholder ?? '便签' })
      return id
    },
  })

  // ② 上服务：给节点内容/别的插件用（第 3 篇）；放个便签=调 addSticker
  ctx.inject('sticker', {
    addSticker: (position: { x: number; y: number }): string =>
      nodeStore.addNode('sticker', position),
  })

  // ③ 加命令：一键放一个便签（第 1/4 篇的 ctx.commands.register）
  ctx.commands.register({
    id: 'sticker:add',
    title: '加一个便签',
    run() {
      const count = nodeStore.getNodes().length
      nodeStore.addNode('sticker', { x: 60 + count * 40, y: 60 + count * 40 })
    },
  })
}

/** 给 demo 装配的模块对象 */
export const stickerPlugin = { name, inject, Config, apply }
```

## 把它装进画布宿主，端到端看效果

打开 demo 装配文件 `packages/canvas-core-v2/demo-web/CanvasDemo.vue`，import 并加进 `plugins` 数组：

```ts
import { stickerPlugin } from './stickerPlugin'      // ← 加这行
// …
const plugins: PluginModule[] = [
  stickerPlugin,        // ← 加进数组（放 theme-default 之后即可，顺序无所谓）
  themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin,
]
```

保存，vite 热更自动刷新。你会看到、能操作三件事：

**① 能点出来一种节点** —— 想让画布出现便签，最简单是复用 commands 插件的统一建节点命令
（经 nodeFactory 走到我们注册的 `create`），浏览器控制台跑：

```js
window.MiniCanvas.getHost().command.execute('command:create-node', { type: 'sticker', position: { x: 220, y: 220 } })
```

画布上立刻多出一张黄底"便签"节点——能拖动、能和别节点连边，行为与 text/image 一致。
（想从工具栏点出来：照 demo 里"文本/图片"按钮的样子加一个按钮调上面这条命令即可。）

**② 能调它的配置** —— 我们导出 `Config`（第 5 篇），内核已把字段登记进 settings。
跑 demo 右下角「插件设置」会看到多出 **便签** 组。想验证"改配置→实时生效"：
控制台改便签开关，观察已放便签的长相跟着变：

```js
const store = window.MiniCanvas.getContext().get('settings')
store.set('sticky', false)   // 便签由黄变橙(橙调) —— 走 settings 单一数据源
store.get('placeholder')     // 读当前值
```

> 想"改动实时刷 UI"而不重建全图？按第 5 篇：`ctx.settings.onChange('sticker', (key,val)=>{…窄更新…})`，
> 或像 demo 那样把某字段窄更新到响应式外观对象上。

**③ 上服务 + 命令都能用** —— `sticker:add` 命令可从工具栏/console 触发（第 1 篇那样）；
`sticker` 服务可被 content/别插件 `ctx.get('sticker')` 调用。

## 你能从这套组合读懂整仓库

`packages/plugins/plugin-node-text`、`plugin-node-image` 就是比上面"便签"更完整的同类：
它们额外用 .vue 做更精致的 content、把编辑写回 + 落盘也做掉。你现在已经能读懂它们的
`name / inject / Config / apply` 四件套和内部对 `ctx` 的使用——mini-canvas 的插件系统，
你掌握的这套写法就是全部了。

## 下一步 / 收尾

你已经会：写插件（01）→ 管生命周期与 effect（02）→ 上服务/依赖（03）→ 事件（04）→
配置（05）→ 组合热重载 + 诊断（06）→ 落进画布端到端（本篇）。

想再深入，按这几条路：

- **想把自己的插件装进任意宿主**：用第 6 篇的 `manager`/manifest —— 只要你的文件满足
  `{ name, inject?, Config?, apply }` 就能被 `manager.install` 或 `applyManifest` 装进任何画布。
- **看真实可复用样板**：`packages/plugins/` 下 text / image / theme-default / commands 四个包。
- **想给节点做精致 UI**：用 .vue 写 content，参照 `plugin-node-text/src/TextContent.vue`；
  节点组件会收到 `{ id, data }` props，需要调服务就 `inject(HOST_KEY)` 后 `host.ctx.get('…')`。

祝你写出自己的画布插件 🎉。
