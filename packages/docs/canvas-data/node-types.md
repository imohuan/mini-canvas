# 注册节点类型与区域词

**一句话定位**：`ctx.nodes.register({...})` 是"往画布上添一种新节点"的**一条 API** —— 它的形状、
默认多大、能不能连线、卡片里放什么组件，一次说全。

**它属于哪一块**：数据层的"画布语义层"（`packages/canvas-data/src/canvas/`）。
相关文件有 `canvas/registry/registerNodeType.ts`（注册助手）、`canvas/region.ts`（十个区域词）、
`canvas/registry/nodeRegistry.ts`（展示注册表）、`canvas/capabilities.ts`（`ctx.nodes` 这套糖的收口）。

## 它是什么

把节点类型想成**一张点菜单**：

- **菜名和份量**（`type` / `label` / `size` / `icon` / `description`）—— 客人（用户）看到的。
- **装盘方式**（`in` / `title` / `segments`）—— 这道菜摆在哪个盘子里。
- **能配什么**（`inputs` / `outputs`）—— 谁的菜能往它上面倒（连接约束）。
- **做菜的手艺**（`create`）—— 点这道菜时，具体怎么把它端上桌。

菜单写完，**同一个定义同时落两张表**：

| 表 | 存什么 | 谁在用 |
| --- | --- | --- |
| `doc` 的类型表（数据侧） | 类型名 / 标题 / 默认尺寸 / 连接约束 / 类型级能力 | 建节点、连接校验、菜单 |
| `nodeRegistry`（展示侧） | 哪个区域的组件是哪个（opaque 句柄） | 节点外壳渲染 |

**为什么必须一次落两处**：早先这两件事是分开的 —— 插件只注册数据，展示组件由**宿主**在
`CanvasDemo` 里手工 seed，UI 与逻辑拆两处、注册权在宿主。现在插件自己声明一次就够，
宿主不用再手写"这个 type 用哪个组件"。

## 为什么需要它

**因为"画布上能有什么"这件事，应该由插件自己说。**

节点类型是插件最核心的自描述：

- 不注册类型，菜单就不知道该列什么（`doc.types` 是只读投影，菜单读它）。
- 不声明端口，连接校验就默认"人人可连"（那是旧语义，容易连出没意义的图）。
- 不声明展示，节点就是一张空白卡片 —— 而且**类型与展示分开写**时，最坏的情况是"注册成功了却什么都不显示"，
  这种 bug 极难查。所以现在的规矩是"字段名就是区域词，写错当场报错"。

一句反面话：**区域名必须闭合。** 老版的位置名有五个（`content` / `top-toolbar` / `bottom-toolbar` / `overlay` 等），
新插件各写各的名字，同一个组件想放到"卡片上边外侧"就有好几种写法，主题改一个样式要翻遍全部插件。
现在只有十个合法区域词，写老名字是**编译期类型错误**、运行时**当场抛错**（并列出全部合法词）。

## 怎么用

### `ctx.nodes.register` 的完整字段

~~~ts
// 文件：packages/canvas-data/src/canvas/capabilities.ts
// 格式：TypeScript 模块（NodeRegisterDef，逐字摘录）
// 位置：作者侧注册节点类型的形状

export interface NodeRegisterDef extends Omit<NodeTypeDef, 'defaultSize'> {
  type: string
  label: string
  /** 尺寸（数据侧叫 defaultSize；作者侧沿用 size） */
  size: { w: number; h: number }

  /** 内容组件（opaque）—— 最常见；落 in 区域（卡片内部，可叠多层） */
  in?: unknown
  /** 标题位组件（opaque）；区域词 title 与老字段同名 */
  title?: unknown

  // 其余展示区域走 segments；也可以直接写 segments 一把交
  segments?: Partial<Record<NodeSegment, unknown>>

  /** 声明式连接约束（端口定义见 canvas/connection 那篇） */
  inputs?: PortDef[]
  outputs?: PortDef[]

  /** 类型图标（opaque 句柄；缺省 = 不显示图标） */
  icon?: unknown
  /** 一句话说明：菜单里"新建节点"项的 hover 小字 */
  description?: string
  /** 新节点默认名称模板：{{ID}} = 该类型递增序号，{{NAME}} = label */
  nameTemplate?: string
  /** 类型级能力：支持拖拽改尺寸（缺省 false） */
  resizable?: boolean
  /** 类型级能力：不要外壳的默认卡片边框（缺省 false），内容铺满整张卡的类型用它 */
  frameless?: boolean
  /** 类型级能力：外壳不画卡片底/投影（缺省 false），容器型（分组）用它让连线透出 */
  transparent?: boolean
  /** 可选：提供"建一个该 type 节点"的实现（挂 nodeFactory，自动回收） */
  create?: NodeCreator
}

/** create 的形状：给个位置，回新节点的 id */
export interface NodeCreator {
  (position: { x: number; y: number }, extra?: unknown): string
}
~~~

几个字段的取舍理由（都来自源码注释）：

- **`in` 不是"另一个名字的 `content`"** —— 字段名本身就是区域词。老字段 `content` 是类型错误，
  运行时也会当场抛错。静默丢弃会表现成"注册成功了却什么都不显示"，比报错难查得多。
- **`size` 而不是 `defaultSize`** —— 数据侧叫 `defaultSize`，作者侧沿用 `size`，由注册助手做映射。
- **`icon` / `description` 由类型自己声明**，因为类型最清楚自己是什么。让菜单层维护一份
  "type 名字 → 文案"的对照表，每加一个类型都得回去补，必漏。
- **`resizable` / `frameless` / `transparent` 是类型级能力**，由渲染层读。曾经因为"两条注册路径只透传了一条"，
  出现过"单测全绿、浏览器里边框照旧"的事故，所以现在两条路都透传。

### 十个区域词（闭合词表）

位置**只能用下面十个词**。词表本体是 `packages/canvas-data/src/canvas/region.ts` 的 `NODE_REGIONS`：

| 区域词 | 贴在哪 | 常见用途 |
| --- | --- | --- |
| `in` | 卡片**内部**（可叠多层） | 内容组件 —— 最常用 |
| `title` | 卡片**标题**那一行 | 就地改名的标题条 |
| `out:top` | 卡片**上边外侧**一条 | 顶部操作条 |
| `out:bottom` | 卡片**下边外侧**一条 | 底部状态栏 / 生成面板 |
| `out:left` | 卡片**左边外侧** | 侧挂按钮、折叠把手 |
| `out:right` | 卡片**右边外侧** | 同上 |
| `on:top` | 贴在卡片**上边框线上** | 进度条 |
| `on:bottom` | 贴在卡片**下边框线上** | 进度条 |
| `over:inset` | 卡片内部的**覆盖层**（不超出卡片） | 编辑浮层（图片裁剪、视频剪辑） |
| `over:outset` | 盖住整张卡、**允许超出边界** | 拖拽手柄、悬停放大 |

~~~ts
// 文件：packages/canvas-data/src/canvas/region.ts
// 格式：TypeScript 模块（词表与守卫，逐字摘录）
// 位置：十个区域词的单一来源

export type NodeRegion =
  | 'in' | 'title'
  | 'out:top' | 'out:bottom' | 'out:left' | 'out:right'
  | 'on:top' | 'on:bottom'
  | 'over:inset' | 'over:outset'

export const NODE_REGIONS = [
  'in', 'title',
  'out:top', 'out:bottom', 'out:left', 'out:right',
  'on:top', 'on:bottom',
  'over:inset', 'over:outset',
] as const

/** 是不是十个区域词之一（闭合词表判定） */
export function isRegion(value: string): value is NodeRegion
/** 只放行十个区域词，其余一律抛清晰错误（并列出全部合法词） */
export function assertRegion(value: string): NodeRegion
~~~

### 老段名已下线（传了会报错）

老五段名**不在**上面的词表里：`content` / `top-toolbar` / `bottom-toolbar` / `overlay`。
写它们是 **TS 类型错误**；类型被绕过时（纯 JS 调用方）由 `assertRegion` **当场抛错**，
消息里还带一句"（老段名，步骤 9 已下线）"和全部合法词。

`region.ts` 里留了一张老名字的表，**只用来报错，不做任何映射或归一**：

~~~ts
// 文件：packages/canvas-data/src/canvas/region.ts
// 格式：TypeScript 模块（下线表，逐字摘录）
// 位置：只为报错提示而存在，不参与放行

export const RETIRED_CONTENT_FIELD = 'content'
export const RETIRED_SEGMENT_NAMES = [
  RETIRED_CONTENT_FIELD,   // 'content'
  'top-toolbar',
  'bottom-toolbar',
  'overlay',
] as const
~~~

> **为什么不留兼容垫片**：注释里写得很直白 —— "垫片永久化就是‘分不清谁是谁’的病根"。
> 静默忽略会让人以为"注册成功了却不显示"，比报错难查得多。

### 展示侧：`NodeRegistry`

`NodeRegistry`（服务名 `'nodeRegistry'`）只存"**用哪个组件渲染某 type 的每个区域**"。
组件句柄是 **opaque**（不透明引用）：数据层不 import Vue，宿主在浏览器侧喂 `.vue`，测试喂 stub。

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `register(type, segments)` | 注册某 type 的展示定义；**该 type 已注册过就抛错** | 节点插件声明"我长什么样" |
| `get(type)` | 取某 type 的展示定义 | 想知道它登记了哪些区域 |
| `unregister(type)` | 注销某 type（不存在也不报错），**连它所有叠加 occupant 一起清** | 热卸插件时回收 |
| `has(type)` | 登记过没有 | 判断依据 |
| `types()` | 已登记的 type 列表 | 诊断 / 遍历 |
| `set(type, segments)` | **覆盖式**重设（没有就新建） | 宿主升级 / 热更；`register` 已存在会抛，它不抛 |
| `subscribe(listener)` | 订阅本表任意变化，返回取消函数 | 渲染宿主运行期重装配 |

区域级叠加（一个区域叠多个组件）：

| 方法 | 一句话 |
| --- | --- |
| `registerContribution(type, segment, { id?, order?, component })` | 往某 type 某区域叠一个 occupant；同 id 已存在 = **替换那一格** |
| `unregisterContribution(type, segment, id)` | 移除一个 occupant；不存在也不报错 |
| `contributionIds(type, segment)` | 已叠的 occupant id 列表 |
| `contributionOccupants(type, segment)` | 当前全部 occupant（按 `order` **升序**） |

**`order` 的方向：越小 = 越在外层 / 优先级越高。** 基座（`register` 时给的组件）永远是第一层，
叠加层排在它之后；新增 occupant 不给 `order` 时的缺省值 = 当前最大 `order` + 1
（若该区域已有基座，首条从 1 起，即排在基座之后）。

### `ctx.nodes.attach` 与 `ctx.selectionRegion.attach`

这是往区域挂组件的**第二条路**（跟 `register` / `contribute` 并列，但用途不同）：

~~~ts
// 文件：packages/canvas-data/src/canvas/capabilities.ts
// 格式：TypeScript 模块（attach 的请求形状，逐字摘录）
// 位置：两个 attach 糖的入参

/** ctx.nodes.attach 的请求：region 是十个区域词之一；needs/props 是条目自己的数据 */
export interface NodeAttachReq {
  region: NodeRegion
  id?: string
  order?: number
  component: unknown
  /** 声明这个组件要用哪些能力包（BaseNode 按名造实例喂给它） */
  needs?: string[]
  /** 组件专属数据，会透传给组件 */
  props?: Record<string, unknown>
}

/**
 * ctx.selectionRegion.attach 的请求：与 NodeAttachReq 的**唯一差别是没有 type** ——
 * 多选框不是某一种节点，它就是"当前选中的一批"。
 * 场键 = 区域词本身（不像节点那样是 type/region）。
 */
export interface SelectionAttachReq {
  region: NodeRegion
  id?: string
  order?: number
  component: unknown
  needs?: string[]
  props?: Record<string, unknown>
}
~~~

**签名**：`ctx.nodes.attach(type: string | '*', req: NodeAttachReq): Disposable`，
`ctx.selectionRegion.attach(req: SelectionAttachReq): Disposable`。

`type` 传 `'*'` 表示**通配所有节点类型**。落点都是注册场（`node/region` 与 `selection/region`），
键 = `type/region`（多选框那边就是 `region` 本身）。返回的 `Disposable` 可以不接
—— 不接就是"纯声明 + 随插件卸载自动摘除"；接了就能手动 `dispose()` 提前撤掉。

**四条路怎么选**：

| 你想干的事 | 用哪个 | 落点 |
| --- | --- | --- |
| 声明"我这个 type 长什么样" | `ctx.nodes.register({ ..., in: Comp })` | 数据表 + `nodeRegistry` |
| 往某个 type 的某个区域**叠**一个组件 | `ctx.nodes.contribute(type, region, Comp, { id, order })` | `nodeRegistry` 的段级槽 |
| 往任意 type（含 `'*'` 通配）挂组件、还要带 `needs` / `props` | `ctx.nodes.attach(typeOrStar, { region, component, needs, props, id, order })` | `node/region` 场 |
| 往**多选框**挂组件（跟具体类型无关） | `ctx.selectionRegion.attach({ region, component, ... })` | `selection/region` 场 |

### 展示怎么被读回（外壳那一侧）

渲染时 `BaseNode` 会把**两条写路径**合成同一摞：`nodeRegistry` 的基座/区域贡献 +
`node/region` 场（含 `'*'` 通配键），按 `order` 升序排，同 id 去重（NodeRegistry 侧优先）。
合成函数是 `nodeRegionStackEntries(registry, regionField, type, region)`，外壳（BaseNode）拿它的结果按区域渲染。

### `defineNode` 助手

觉得"写一个 `apply(ctx)` 只为了注册一个节点"太啰嗦，可以整个插件就是一次 `defineNode(...)`：

~~~ts
// 文件：packages/canvas-base/src/define.ts
// 格式：TypeScript 模块（defineNode，逐字摘录）
// 位置：插件作者薄层 @mini-canvas/canvas-base

export type DefineNodeDef = NodeRegisterDef

/**
 * defineNode —— 声明"一种画布节点"（数据 + 展示 + 可选建节点实现）。
 * @returns PluginModule（name = type，apply 里 ctx.nodes.register）
 */
export function defineNode(def: DefineNodeDef) {
  return {
    name: def.type,
    inject: [] as string[],
    apply(ctx: Context) {
      // 原样转发：NodeRegisterDef 是字段的单一来源，这里不再手写透传清单
      ctx.nodes.register({ ...def })
    },
  }
}
~~~

用法（`name` 直接取 `def.type`，所以一个文件一个类型最自然）：

~~~ts
// 文件：my-node/src/index.ts
// 格式：TypeScript 模块（插件入口，用 defineNode 声明）
// 位置：插件包源码入口
import { defineNode } from '@mini-canvas/canvas-base'
import AudioContent from './AudioContent.vue'

export default defineNode({
  type: 'audio',
  label: '音频',
  size: { w: 200, h: 80 },
  in: AudioContent,
})
~~~

> `DefineNodeDef` 就是 `NodeRegisterDef`（源码里直接 `export type DefineNodeDef = NodeRegisterDef`），
> **不在这里再抄一份字段清单** —— 抄一份的下场已经踩过：类型上放行的 `icon` / `resizable` / `frameless`
> 在运行时被静默丢掉，作者写了不报错也不生效。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| 文本节点 | `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts` | `ctx.nodes.register` 声明 text 类型 + `inputs`/`outputs`/`create` |
| 图片节点 | `packages/plugins/plugin-node-image/src/nodeImagePlugin.ts` | 同上；注释里写着"以前这里写 capacity:1 把它限成一条"的教训 |
| 3D 预览节点 | `packages/plugins/plugin-node-3d-preview/src/node3dPreviewPlugin.ts` | `outputs: []` 声明终点型节点 + `resizable: true` |
| 底部状态栏 | `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts` | `ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, ... })` |
| 多选群组框 | `packages/plugins/plugin-multi-select/src/multiSelectPlugin.ts` | `ctx.selectionRegion.attach({ region: 'out:top', needs: ['selection'], ... })` |
| 节点外壳 | `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 合成 `nodeRegistry` + `node/region` 场，按区域词渲染 |
| 注册助手 | `packages/canvas-data/src/canvas/registry/registerNodeType.ts` | `ctx.nodes.register` 内部调它，一次落数据 + 展示两张表 |
| 展示注册表 | `packages/canvas-data/src/canvas/registry/nodeRegistry.ts` | 存"哪个区域用哪个组件"，段名逐个过 `assertRegion` |
| 区域读取 | `packages/canvas-data/src/canvas/region.ts` | `nodeRegionStackEntries` 把两条写路径合成同一摞 |

## 完整例子

下面这个小插件做四件事：**注册一种新节点**（数据 + 展示一次给全）、**往所有节点的标题位叠一个角标**、
**往图片节点的上控制栏挂一个按钮**、**往多选框的上控制栏挂一项**。

同样的文件在仓库里也放了一份，可直接打开对照：
`packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/`。

### 目录树

~~~
plugin-stamp-node/
├── package.json                     # 清单：包名 / 入口 / miniCanvas 元信息
└── src/
    ├── index.ts                     # 插件入口：注册节点类型 + 三处区域挂载
    ├── StampContent.vue             # in 区域：邮票卡片的内容
    ├── StampTitle.vue               # title 区域：标题行
    ├── TitleBadge.vue               # 通配角标（type '*' 的 title 位）
    ├── TopPin.vue                   # 图片节点上控制栏里的按钮（out:top）
    └── SelectionPin.vue             # 多选框上控制栏里的一项（selection/region）
~~~

### `package.json`（全文）

~~~json
{
  "name": "@mini-canvas/plugin-stamp-node",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "演示：邮票节点",
    "description": "注册一种新节点 + 往标题位叠角标 + 给图片节点和多选框挂按钮",
    "pluginName": "stamp-node",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*"
  },
  "peerDependencies": {
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
~~~

### `src/StampContent.vue`（全文）

~~~vue
<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/StampContent.vue
     格式：Vue 单文件组件（in 区域：卡片内部的内容）
     位置：插件包内部；由 ctx.nodes.register 的 in 字段挂进注册表 -->
<script setup lang="ts">
/** 内容组件拿到的是外壳透传的 props：节点 id 与它的 data（见 BaseNode 透传规则） */
const props = defineProps<{ id: string; data?: Record<string, unknown> }>()
</script>

<template>
  <div class="stamp-content">
    <div class="stamp-rank">{{ String(props.data?.rank ?? '—') }}</div>
    <div class="stamp-note">{{ String(props.data?.note ?? '（双击写点什么）') }}</div>
  </div>
</template>

<style scoped>
/* 颜色一律走主题 token（见「主题与配色」那一组），不写死数值 */
.stamp-content {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
  color: var(--ui-ink, #18202b);
  font-size: 13px;
}
.stamp-rank {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-weight: 700;
}
.stamp-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>

~~~

### `src/StampTitle.vue`（全文）

~~~vue
<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/StampTitle.vue
     格式：Vue 单文件组件（title 区域：标题那一行）
     位置：插件包内部；由 ctx.nodes.register 的 title 字段挂进注册表 -->
<script setup lang="ts">
const props = defineProps<{ data?: Record<string, unknown> }>()
</script>

<template>
  <span class="stamp-title">{{ String(props.data?.label ?? '邮票') }}</span>
</template>

<style scoped>
.stamp-title { color: var(--ui-ink-dim, #6b7280); font-size: 12px; }
</style>
~~~

### `src/TitleBadge.vue`（全文）

~~~vue
<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/TitleBadge.vue
     格式：Vue 单文件组件（通配角标）
     位置：插件包内部；由 ctx.nodes.attach('*', { region: 'title' }) 挂到**所有**节点类型上 -->
<template>
  <span class="title-badge">NEW</span>
</template>

<style scoped>
.title-badge {
  padding: 0 5px;
  border-radius: 6px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
</style>
~~~

### `src/TopPin.vue` 与 `src/SelectionPin.vue`（全文）

~~~vue
<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/TopPin.vue
     格式：Vue 单文件组件（图片节点上控制栏里的一个按钮）
     位置：插件包内部；由 ctx.nodes.attach('image', { region: 'out:top' }) 挂到 image 类型上
     说明：needs 声明要用哪些能力包 —— 组件按名拿到，不自己 ctx.get 拼 -->
<script setup lang="ts">
// 能力包按名取：needs: ['node'] 在 ctx.nodes.attach 里声明（忘了写会拿到 undefined，dev 有提示）
import { useCapability } from '@mini-canvas/canvas-render'

// NodeCapability 的形状来自渲染层标准能力包（packages/canvas-render/src/contracts/standardCapabilities.ts）
const node = useCapability<{ readonly id: string; readonly type: string }>('node')
</script>

<template>
  <button class="top-pin" type="button" :title="'给节点 ' + (node?.id ?? '') + ' 盖个章'">
    ⭐
  </button>
</template>

<style scoped>
.top-pin {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ntb-text, #6b7280);
  cursor: pointer;
}
.top-pin:hover { background: var(--ntb-fill-hover, rgb(0 0 0 / 0.06)); color: var(--ntb-text-strong, #111827); }
.top-pin:focus-visible { outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
</style>
~~~

~~~vue
<!-- 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/SelectionPin.vue
     格式：Vue 单文件组件（多选框上控制栏里的一项）
     位置：插件包内部；由 ctx.selectionRegion.attach({ region: 'out:top' }) 挂到"当前选中的一批"上 -->
<template>
  <button class="selection-pin" type="button">批量盖章</button>
</template>

<style scoped>
.selection-pin {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ntb-text, #6b7280);
  font-size: 11px;
  cursor: pointer;
}
.selection-pin:hover { background: var(--ntb-fill-hover, rgb(0 0 0 / 0.06)); }
</style>
~~~

### `src/index.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import StampContent from './StampContent.vue'
import StampTitle from './StampTitle.vue'
import TitleBadge from './TitleBadge.vue'
import TopPin from './TopPin.vue'
import SelectionPin from './SelectionPin.vue'

export const name = 'stamp-node'
// 类型图标（opaque 句柄）：仓库里的节点插件都传 SVG 字符串，主题按 currentColor 上色
const STAMP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 10h8M8 14h5"/></svg>'
// 硬依赖：doc（数据那半边）与 nodeRegistry（展示那半边）
export const inject = ['doc', 'nodeRegistry'] as string[]

export function apply(ctx: Context) {
  // ① 注册一种新节点：数据 + 展示 + 建法，一次给全。
  //    字段名就是区域词 —— in 是"卡片内部"，title 是"标题那一行"。
  //    写老名字 content 会被 TS 拦住，纯 JS 调用方传进来会当场抛错。
  ctx.nodes.register({
    type: 'stamp',
    label: '邮票',
    description: '一张带编号的小卡片，可当备忘或标签用',
    size: { w: 240, h: 96 },
    nameTemplate: '邮票 {{ID}}',
    in: StampContent,
    title: StampTitle,
    // icon 是 opaque 句柄：仓库里的节点插件传 SVG 字符串，也可以传组件
    icon: STAMP_ICON,
    resizable: true,
    // 只接文本上游；不声明 capacity = 不限条数
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'stamp' }],
    // ② create：给"从菜单/命令建一个邮票"提供实现，自动挂进 nodeFactory
    create(position) {
      return ctx.get('doc').createNode('stamp', position, { rank: 1, note: '' })
    },
  })

  // ③ 往**所有节点类型**的标题位叠一个角标（type 传 * = 通配）。
  //    落点是 node/region 注册场（键 = '*' + '/' + 'title'），随本插件卸载自动摘除。
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'stamp-node/title-badge',
    component: TitleBadge,
  })

  // ④ 往**图片节点**的上控制栏挂一个按钮。
  //    needs 声明组件要用哪些能力包（BaseNode 按名造实例喂给它）；
  //    props 是这条自己的数据，会透传给组件。
  ctx.nodes.attach('image', {
    region: 'out:top',
    id: 'stamp-node/top-pin',
    component: TopPin,
    needs: ['node'],
    props: { tip: '盖个章' },
  })

  // ⑤ 往**多选框**的上控制栏挂一项。形状与节点那边逐字同形，**唯一差别是没有 type**
  //    —— 多选框不是某一种节点，它就是"当前选中的一批"。
  ctx.selectionRegion.attach({
    region: 'out:top',
    id: 'stamp-node/selection-pin',
    component: SelectionPin,
    needs: ['selection'],
    order: 20,
  })

  // ⑥ 诊断命令：把展示注册表里登记了什么念出来（读操作，不改任何东西）
  ctx.commands.register({
    id: 'stamp-node:inspect',
    title: '邮票：看看展示注册表',
    run: () => {
      const reg = ctx.get<{
        types(): string[]
        get(type: string): { segments: Record<string, unknown> } | undefined
      }>('nodeRegistry')
      console.log('[stamp-node] 已登记展示的类型：' + reg.types().join(' / '))
      console.log('[stamp-node] stamp 的区域：' + Object.keys(reg.get('stamp')?.segments ?? {}).join(' / '))
      return true
    },
  })
}
~~~

**六步各自的意思**：

1. `ctx.nodes.register` 是作者侧唯一入口 —— 它内部调 `registerNodeType(ctx, def)`，
   一次把数据与展示两张表都落好，并把这些注册挂进当前插件的 scope（卸载即回收，
   所以同名插件重装不会撞"类型已注册"）。
2. 给了 `create` 就自动挂进 `nodeFactory`（服务名 `'nodeFactory'`），菜单 / 命令 / AI 工具都能
   通过 `factory.create('stamp', pos)` 建节点。
3. `ctx.nodes.attach('*', …)` 里的 `*` 是**通配所有类型**：一条注册就让所有节点都长角标。
4. `needs` 是"这条条目声明要用哪些能力包"—— 组件里用 `useCapability('node')` 取到。
   **最容易踩的坑是忘了写 `needs`**：那会静默 `undefined`，dev 下会有一条 warning 提醒。
5. 多选框那条与节点那条**形状逐字相同，只少一个 `type`** —— 这是刻意的，学会一个就会另一个。
6. 读操作（`types()` / `get()`）不需要事务，也不会改任何东西。

## 常见坑

1. **区域词只有十个，老名字当场报错。**
   `content` / `top-toolbar` / `bottom-toolbar` / `overlay` 都已下线：写它们会被 TS 拦住；
   纯 JS 调用方传进来时 `assertRegion` 会抛错并列出全部合法词。别指望"它能自动认出来"——
   不留垫片是刻意的选择（垫片永久化就是"分不清谁是谁"的病根）。

2. **一个 type 在三处是键，三处都"重复即抛"。**
   `doc` 的类型表、`nodeRegistry`、`nodeFactory` 各以 `type` 为键，重复注册都会抛错。
   好消息是热卸插件会把它们一起注销，所以同名插件重装（热重载）不会撞 —— 只要注册走了
   `ctx.nodes.register` 或 `registerNodeType`（它们把注销挂进了插件 scope）。

3. **`in` 与 `segments` 的关系：`in` / `title` 是便捷字段，其余区域走 `segments`。**
   `ctx.nodes.register` 内部会把 `in`、`title` 与 `segments` 合并成同一份段记录。
   想写 `out:bottom` 这类带冒号的区域，用 `segments: { 'out:bottom': Comp }` 更直观。

4. **展示侧注册失败会整体回滚。**
   如果 `nodeRegistry` 里这个 type 已被别人占用而数据表没有，`registerNodeType` 会**回滚数据侧**，
   保证"要么两张表都注册、要么都不注册"，不会留下只落了一半的 type。

5. **`needs` 忘了写 ≠ 能力没注册，但两者长得一样。**
   组件里 `useCapability('node')` 返回 `undefined` 有两种原因：① 你没在 attach 里声明 `needs`；
   ② 声明了但没人注册。渲染层在 dev 下会把这两种区分开并给出提示（提示里甚至列出你声明了哪些）。
   另外，`useCapabilities()` 只能在 BaseNode 的区域渲染子树里用 —— 挂在画布级浮层（`ctx.slots`）上的组件
   拿不到节点能力，那种场景请直接 `ctx.get(...)` 取服务。

6. **`order` 越小越在外层。**
   单赢家槽（如 `nodeShell`）取 `order` 最小者；可叠多层的槽里 `contributionOccupants` 按 `order` 升序返回，
   第一条在最外。想顶替别人的组件不需要删别人的，只要放一条 `order` 更小的 —— 底层永远还在，
   这正是"换皮"能安全生效的前提。
