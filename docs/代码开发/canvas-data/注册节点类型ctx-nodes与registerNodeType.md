# 注册一个节点类型：ctx.nodes.register 与 registerNodeType

> 来源：`packages/canvas-data/src/canvas/capabilities.ts`、`packages/canvas-data/src/canvas/registry/registerNodeType.ts`、
> `packages/canvas-data/src/canvas/registry/nodeRegistry.ts`、`packages/canvas-data/src/canvas/registry/nodeRenderer.ts`、
> `packages/canvas-data/src/canvas/region.ts`、`packages/canvas-data/src/nodeStore.ts`、
> `packages/canvas-data/src/canvas/nodeFactory.ts`、`packages/canvas-base/src/define.ts`

插件往画布上加一种"新节点"（文本块、图片块…），只需注册一个**节点类型**：
说清它的数据形状 / 默认尺寸、用什么组件渲染各区域、能不能连 / 怎么连。

---

## 1. 一条 API 搞定（推荐）：`ctx.nodes.register`

在插件 `apply` 里调一次，把**数据 + 展示 + 可选建节点**都给全（`capabilities.ts:197`）：

```ts
import type { Context } from '@mini-canvas/canvas-base'
import TextContent from './TextContent.vue'
import TitleBar from './TitleBar.vue'
import GeneratePanel from './GeneratePanel.vue'

export function apply(ctx: Context) {
  ctx.nodes.register({
    type: 'text',                          // 唯一类型名
    label: '文本',                          // UI 上显示的名字
    description: '在画布中添加一个文本节点',  // 可选：菜单"新建节点"项的 hover 小字
    size: { w: 300, h: 200 },              // 默认尺寸（数据侧叫 defaultSize）
    in: TextContent,                       // in 区域组件（卡片内部，最常用）
    title: TitleBar,                       // 可选：标题区域组件
    segments: {                            // 可选：其它区域
      'out:bottom': GeneratePanel,
    },
    resizable: true,                       // 可选：类型级能力
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    create: (pos) => ctx.get('doc').createNode('text', pos),   // 可选：建该 type 节点
  })
}
```

### 1.1 `NodeRegisterDef` 全字段（`capabilities.ts:35`）

```ts
interface NodeRegisterDef extends Omit<NodeTypeDef, 'defaultSize'> {
  type: string
  label: string
  size: { w: number; h: number }             // 作者侧字段名（数据侧叫 defaultSize）
  in?: unknown                               // 卡片内部（区域词 in）
  title?: unknown                            // 标题位
  segments?: Partial<Record<NodeRegion, unknown>>   // 其余区域
  inputs?: PortDef[]
  outputs?: PortDef[]
  icon?: unknown
  description?: string
  resizable?: boolean
  frameless?: boolean
  transparent?: boolean
  create?: NodeCreator                      // (position, extra?) => string
}
```

**注意 `in` 这个字段名**：老版作者侧字段叫 `content`，现在**已下线** ——
字段名就是区域词，写 `content` 是 **TS 类型错误**；JS 调用方漏网传进来时，
`ctx.nodes.register` 会**当场抛错**（不静默丢弃组件，否则会表现为"注册成功了却什么都不显示"）。

`create` 传的是 `NodeCreator`：`(position: { x: number; y: number }, extra?: unknown) => string`，
返回新节点 id。它会自动挂进 `nodeFactory`（见 §5）。

### 1.2 自动回收

插件卸载 / `ctx.stop()` 时，`doc` 类型表里的 type 与 `nodeRegistry` 的展示会**一起注销**，
所以同名插件重装（热重载）不会撞"类型已注册"。

> 落点：`ctx.nodes.register` 内部走 `registerNodeType(ctx, def)`（数据 + 展示），
> 另外往 `node/type` 场落一条声明摘要、给了 `create` 就再往 `node/creator` 场落一条。

---

## 2. 低层入口：`registerNodeType(ctx, def)`（`registry/registerNodeType.ts:70`）

`ctx.nodes.register` 内部就是调它。想不走能力段、直接在插件里调也成：

```ts
import { registerNodeType } from '@mini-canvas/canvas-data'
import AudioContent from './AudioContent.vue'

const revoke = registerNodeType(ctx, {
  type: 'audio',
  label: '音频',
  defaultSize: { w: 100, h: 60 },            // 这里的字段名是 defaultSize（不是 size）
  segments: { in: AudioContent },            // 展示区域（in = 卡片内部）
  inputs: [{ port: 'target', acceptsTypes: ['audio'] }],
  outputs: [{ port: 'source' }],
})
```

### 2.1 `NodeTypeDef` 全字段（`registerNodeType.ts:39`）

```ts
interface NodeTypeDef {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  segments?: Partial<Record<NodeSegment, unknown>>   // NodeSegment = NodeRegion（十个区域词）
  inputs?: PortDef[]
  outputs?: PortDef[]
  icon?: unknown
  description?: string
  resizable?: boolean
  frameless?: boolean
  transparent?: boolean
}
```

返回 `revoke` 会自动登记进当前插件 scope（卸载时注销数据 + 展示）。

### 2.2 两个入口的参数差异

|  | `ctx.nodes.register` | `registerNodeType` |
| --- | --- | --- |
| 默认尺寸字段 | `size` | `defaultSize` |
| 内容组件 | `in` / `title` 单独字段 | 合并进 `segments`（`{ in: … }`） |
| 建节点 | `create`（自动挂 nodeFactory） | 不支持 |
| 展示侧缺失时 | — | `nodeRegistry` 取不到则只落数据 |

`ctx.nodes.register` 把 `size` 映射成 `defaultSize`，把 `in` / `title` 合并进 `segments`。

> **数据契约**：数据型节点还要声明 `produces/consumes`（我产出什么、从上游读什么），
> 详见 `docs/design/node-data-and-upstream-contract.md`。只声明 `inputs/outputs` 时，
> 下游只能知道“能连”，不知道“连上后读哪个字段”。

> 一个真实踩过的坑：类型级能力（`resizable` / `frameless` / `transparent`）是**手写枚举逐字段透传**的。
> 曾经给图片节点加 `frameless` 时只补了 `registerNodeType` 那条路、漏了 `ctx.nodes.register` 那条，
> 结果单测全绿、浏览器里边框照旧。现在两条路都透传，并有测试锁住。

---

## 3. 节点区域词（十个，闭合词表）

区域**决定贴在哪儿**（几何，主题管），**名字自由**（插件管）。词表在
`packages/canvas-data/src/canvas/region.ts:22` 的 `NodeRegion`：

| 区域词 | 贴在哪 | 用途 |
| --- | --- | --- |
| `title` | 标题位（单个） | 就地改名的标题条 |
| `in` | 卡片内部（可叠多层） | 内容组件（最常用） |
| `out:top` | 卡片上边外侧一条 | 顶部操作条 |
| `out:bottom` | 卡片下边外侧一条 | 底部状态栏 / 生成面板 |
| `out:left` / `out:right` | 左右外侧 | 侧挂按钮、折叠把手 |
| `on:top` / `on:bottom` | 贴在卡片边框线上 | 进度条 |
| `over:inset` | 卡片内部覆盖层（不超出卡片） | 编辑浮层（图片裁剪、视频剪辑） |
| `over:outset` | 盖住整张卡且允许超出边界 | 拖拽手柄、悬停放大 |

**老五段名已下线**：`content`（→ `in`）、`top-toolbar`（→ `out:top`）、
`bottom-toolbar`（→ `out:bottom`）、`overlay`（→ `over:inset`）。写它们会被 TS 拦住；
运行时（类型被绕过时）`assertRegion` 抛错**并列出十个合法词**（`region.ts:89`）。
不做归一、不留垫片 —— 静默忽略只会让人以为"注册成功了却不显示"，比报错难查得多。

```ts
import { NODE_REGIONS, assertRegion } from '@mini-canvas/canvas-data'
NODE_REGIONS       // ['in','title','out:top',…]（十个，诊断 / 枚举用）
assertRegion('in')      // 'in'
assertRegion('content') // 抛错：不是合法区域词（老段名，已下线）
```

> 别和画布级浮层搞混：`ctx.slots.register('overlay', …)` 是**画布级**浮层（与小地图同类），
> 不是节点位置，不进区域词表。

---

## 4. 展示侧：NodeRegistry（哪个区域用什么组件）

`NodeRegistry`（`ctx.get('nodeRegistry')`，`registry/nodeRegistry.ts:70`）只存
"**用哪个组件渲染某 type 的每个区域**"。组件句柄是 opaque（数据层不 import Vue，宿主喂 `.vue`、测试喂 stub）。

```ts
const reg = ctx.get('nodeRegistry')
reg.register('text', { in: TextContent })    // 注册展示定义（重复抛错）
reg.get('text')?.segments.in                 // 取 in 区域组件
reg.has('text')                              // true
reg.types()                                  // ['text', ...]
reg.set('text', { in: NewContent })          // 覆盖式重设（宿主升级 / 热更，未注册则新建）
reg.unregister('text')                       // 注销（一并清掉该 type 的叠加 occupant）
reg.subscribe(() => {})                      // 变更订阅（渲染侧重装配用）
```

### 4.1 同一区域还能叠多个 occupant（装饰层 / 徽标层）

一个区域既是"基座单值"，也是可叠加的开放槽。用能力段 `ctx.nodes.contribute`：

```ts
// 插件 A、B 都往 text 的 title 区域叠徽标
ctx.nodes.contribute('text', 'title', BadgeA, { id: 'a' })
ctx.nodes.contribute('text', 'title', BadgeB, { id: 'b' })
// 返回 occupant id（string）
```

底层对等方法在 `NodeRegistry` 上：

```ts
reg.registerContribution('text', 'title', { id: 'a', component: BadgeA })  // 返回 occupant id
reg.contributionIds('text', 'title')          // ['a']
reg.contributionOccupants('text', 'title')    // [{ id, order, component }]，按 order 升序
reg.unregisterContribution('text', 'title', 'a')
```

- 同 id 已存在 → **替换**那格；否则追加。
- `order` 缺省 = 该区域基座存在时从 1 起（排在基座之后），否则从 0 起；其后 = 已有最大 + 1。
- 热卸只抽走该插件贡献的 occupant，基座与其它贡献原位保留。

### 4.2 读展示的纯函数（NodeRenderer，`registry/nodeRenderer.ts`）

宿主 / `BaseNode` 用这些把 type 解析成"该渲染啥"：

```ts
import { resolveSegment, hasContent, activeSegments, nodeSegmentStack, nodeSegmentStackEntries }
  from '@mini-canvas/canvas-data'

resolveSegment(reg, 'text', 'in')       // 该区域**基座**组件（没给 → undefined）
nodeSegmentStack(reg, 'text', 'in')     // 可叠加渲染：基座 + 按 order 的 occupant，组件数组
nodeSegmentStackEntries(reg, 'text', 'in')  // 同上，但每项带稳定 id（渲染列表 key 用）
hasContent(reg, 'text')                 // in 区域是否显式注册了基座
activeSegments(reg, 'text')             // 哪些区域"要渲染"（有组件或有 occupant）
```

> 为什么要 `…Entries`：渲染层把栈铺成循环渲染需要 key。用下标会在 occupant 增删（插件热装卸）时
> 让 Vue 复用错的组件实例；基座固定 id `'base'`、occupant 用它注册时的 id，才是对的。
> 传老段名给这些函数会当场抛错（`assertRegion`）。

---

## 5. 建节点统一入口：nodeFactory（`create` 会挂这里）

给了 `create`，它就注册进 `NodeFactory` 服务（`ctx.get('nodeFactory')`），
让"建一个 X 节点"收敛到一处 —— 宿主 / 命令 / 菜单只调 `create(type, pos)`：

```ts
ctx.nodes.register({
  type: 'text', label: '文本', size: { w: 300, h: 200 }, in: TextContent,
  create: (pos, extra) => ctx.get('doc').createNode('text', pos, { text: '' }),
})

const factory = ctx.get('nodeFactory')
factory.create('text', { x: 0, y: 0 }, extra)   // 返回新节点 id
factory.creatableTypes()                        // 可创建的 type 列表（菜单枚举用）
```

细节见《数据门面 doc 与建节点 nodeFactory》篇 §5。要点：`type` 未注册 creator 时
`create` **抛错**（不静默）；重复注册也抛错；`create` 会随插件卸载一起注销。

---

## 6. `defineNode` 助手（`@mini-canvas/canvas-base`）

作者想少写一层 `apply` 时，可以整个插件就是一个 `defineNode(...)` 的返回值（`canvas-base/src/define.ts`）：

```ts
import { defineNode } from '@mini-canvas/canvas-base'
import AudioContent from './AudioContent.vue'

export default defineNode({
  type: 'audio',
  label: '音频',
  size: { w: 200, h: 80 },
  in: AudioContent,
})
```

它返回一个 `PluginModule`（`name` = `type`，`apply` 里调 `ctx.nodes.register`），
直接 `ctx.plugin(defineNode({...}))` 即可。

> **当前实现的边界**（照 `canvas-base/src/define.ts` 逐字读出来的，不替它编行为）：
>
> - `defineNode` 只透传 `type / label / size / description / in / title / inputs / outputs / create` 这几项；
>   要 `segments` / `icon` / `resizable` / `frameless` / `transparent`，请写完整 `apply(ctx)` + `ctx.nodes.register`。
> - 它的 `create` 字段收的是 `NodeCreator`（`(pos, extra?) => string`），**在 defineNode 里拿不到 ctx**。
>   所以"建节点时先写默认 data / 调 `doc.createNode`"这类 creator，请直接写在 `apply(ctx)` 里（那里能闭包 ctx）。

---

## 7. 坑与速记

1. **装配前要有服务**：`ctx.nodes.register` / `registerNodeType` 需要 `doc`（数据侧）与
   `nodeRegistry`（展示侧）在 ctx 里。展示侧注册在取不到 `nodeRegistry` 时会**静默跳过**（只落数据）。
2. `type` 在数据表、`nodeRegistry`、`nodeFactory` 三处都以它为键，各自**重复注册抛错**。
3. 组件句柄 **opaque**：内核不 import Vue，传 `.vue` / stub / 任意对象都行。
4. 区域词只有十个；老五段名是**类型错误 + 运行时抛错**，没有归一、没有垫片。
5. `in` 不是"另一个名字的 content"，它就是区域词本身。作者侧只认 `in`。
6. 节点 id 是短数字自增；`doc.replaceAll` 回填后 id 计数器会重建防撞（见《数据门面 doc》篇）。
7. 想渲染"该 type 当前该用什么"，用 `nodeRenderer` 的纯函数，别自己复制一份注册逻辑。
8. `ctx.nodes.attach(type | '*', { region, component, needs?, props? })` 是**另一条**往区域挂组件的路
   （落 `node/region` 场，支持 `'*'` 通配所有类型、支持 `needs`/能力包与组件专属 `props`）。
   要"所有节点类型都加一个角标"这类需求用它；单类型叠装饰层用 `contribute` 更直接。
