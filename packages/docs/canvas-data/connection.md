# 连接校验 connection

**一句话定位**：`packages/canvas-data/src/canvas/connection.ts` 是**连线的守门人** —— 一条线能不能连，
由它说了算。它是一堆**纯函数**：给同样的输入，永远得同样的答案，跟浏览器、跟 Vue 都没关系。

**它属于哪一块**：数据层里的"画布语义层"。它只依赖 `nodeStore` 的 `PortDef` 类型定义，
不依赖任何实例，所以可以在 Node 里一条一条地测。

## 它是什么

把它想成**高速公路入口的检查站**。每辆车（连接）想上路，先过四道岗：

| 岗 | 问什么 | 不过的原因码 |
| --- | --- | --- |
| 方向 | 车头朝对了吗 | `bad-orientation` |
| 身份 | 两端的人和车都在图上吗 | `missing-node` |
| 规矩 | 自己连自己吗？会绕成圈吗？重复了吗？ | `self-loop` / `cycle` / `duplicate` |
| 通告牌 | 这个口允许接这种车吗？位子满了吗？ | `no-source-port` / `no-target-port` / `type-not-accepted` / `limit-reached` |

过了四道岗，它会给你一张"通行证"：`{ ok: true, canonical }` —— `canonical` 就是**翻正后的端点对**，
拿去建边即可。

## 为什么需要它

**因为"在哪能连"这件事必须只有一个答案。**

项目里已经踩过这类坑（都写在源码注释里，不是猜的）：

- **同一个判定写过好几份。** 加边的容量决策以前散在渲染宿主一份、插件里各一份
  （`image-compare` 甚至专门声明"上限 +1 缓冲位"来绕开内核）。判定分散的结果就是行为漂移 ——
  用户实测报的"同一条边拖过去能连、框选批量连却被拒"就是这个根因。现在唯一实现在
  `pickOverflowEvict`，别在别处再抄一份。
- **不声明容量被当成 1 用。** 于是图片、文本这类本该接多个上游的节点接不了第二条，
  用户实测报的"图片输入端口分明可以添加多条连接线"就是它。现在的语义是：**不声明 = 不限条数**。
- **"已存在的边"被当成"重复"驳回。** VueFlow 每次 `setEdges` 都会把所有边重喂一遍，
  如果按"重复"驳回，已落盘的边会被丢掉 —— 表现就是"拖完线看不见"。所以宿主侧多了一步"幂等放行"。

## 怎么用

### 输入形状

~~~ts
// 文件：packages/canvas-data/src/canvas/connection.ts
// 格式：TypeScript 模块（接口定义，摘录）
// 位置：数据层连接校验

/** 一条待校验的连接（与 VueFlow 的 Connection 同构） */
interface ConnectionInput {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** 已存在的边（最小形状即可比较） */
interface ExistingEdge {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  data?: { isTemp?: boolean }
}

/** 校验上下文：调用方负责把"现有节点 / 现有边 / 类型声明"喂进来 */
interface ValidateContext {
  /** 当前存在的节点（id → type） */
  nodes: Map<string, { id: string; type: string }>
  /** 已存在的边（含中间态标记） */
  edges: ExistingEdge[]
  /** 由 nodeStore.types 反查某 type 的连接声明 */
  getTypeConn: (type: string) => NodeConnectionDef | undefined
}
~~~

### 纯函数逐个过一遍

这些函数各自独立可测，没有隐藏状态：

| 函数 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `normalizeConnection(c)` | 缺 handle 归一成 `'source'` / `'target'` | 想先把形状补全再比 |
| `toCanonicalConnection(c)` | 翻成统一方向（source = 输出端）；翻不了返回 `null` | 判定方向是否合法 |
| `getCanonicalEndpoints(e)` | 已存在的边也翻一次（缺 handle 归一后再翻） | 拿旧边做比较 |
| `wouldCreateCycle(source, target, edges)` | 从 target 沿正向边 DFS，能走回 source 就成环 | 拖线时提前预警 |
| `isSameConnection(edge, canonical)` | 某条边与规范端点是不是同一连接（跨 handle） | 去重 |
| `findDuplicate(canonical, edges)` | 找已存在的同一条连接 | 去重 |
| `resolveTargetInputPort(typeConn, handle)` | 解析这次连接**实际用的是哪个输入口** | 多端口类型的容量/约束判定 |
| `resolveSourceOutputPort(typeConn, handle)` | 同上，输出口那一侧 | 同上 |
| `typeConnectionDef(def)` | 从类型定义里取出 `{ inputs, outputs }`（没声明给 `undefined`） | 喂给 `getTypeConn` |
| `pickOverflowEvict(input)` | 满额时该挤掉哪一条入边（返回边 id 或 `null`） | 落边前腾位 |

~~~ts
// 文件：packages/canvas-data/src/canvas/connection.ts
// 格式：TypeScript 模块（函数签名，逐字摘录）
// 位置：数据层连接校验的公开面

export function normalizeConnection(c: ConnectionInput): NormalizedConnection
export function toCanonicalConnection(c: ConnectionInput): CanonicalEndpoints | null
export function getCanonicalEndpoints(e: ExistingEdge): CanonicalEndpoints | null
export function wouldCreateCycle(source: string, target: string, edges: ExistingEdge[]): boolean
export function isSameConnection(edge: ExistingEdge, canonical: CanonicalEndpoints): boolean
export function findDuplicate(canonical: CanonicalEndpoints, edges: ExistingEdge[]): ExistingEdge | undefined
export function resolveTargetInputPort(
  typeConn: NodeConnectionDef | undefined,
  targetHandle: string | null | undefined,
): PortDef | undefined
export function resolveSourceOutputPort(
  typeConn: NodeConnectionDef | undefined,
  sourceHandle: string | null | undefined,
): PortDef | undefined
export function typeConnectionDef(
  def: { inputs?: PortDef[]; outputs?: PortDef[] } | undefined,
): NodeConnectionDef | undefined
export function pickOverflowEvict(input: {
  typeConn: NodeConnectionDef | undefined
  edges: ReadonlyArray<EvictableEdge>
  target: string
  targetHandle?: string | null
}): string | null
~~~

### `validateConnection` 完整签名

~~~ts
// 文件：packages/canvas-data/src/canvas/connection.ts
// 格式：TypeScript 模块（唯一守门人的签名，逐字摘录）
// 位置：加边路径上的核心判定

export function validateConnection(
  conn: ConnectionInput,
  ctx: ValidateContext,
  opts: { allowMissingNodes?: boolean } = {},
): ValidationResult

export interface ValidationResult {
  ok: boolean
  /** 通过时是 'ok'；不通过时是下面的原因码之一 */
  reason: InvalidReason | 'ok'
  /** **通过时**给的规范化 canonical 端点（source = 输出端、target = 输入端）—— 拿它建边 */
  canonical?: CanonicalEndpoints
}

export type InvalidReason =
  | 'missing-node'      // 端点不存在（或为空）
  | 'self-loop'         // 自己连自己
  | 'bad-orientation'   // 口对口的方向非法（两个口在同一侧）
  | 'no-source-port'    // 源类型声明了 outputs: []，没有输出口
  | 'no-target-port'    // 目标类型声明了 inputs: []，没有输入口
  | 'type-not-accepted' // accepts / acceptsTypes 不接受这个源
  | 'limit-reached'     // 输入口满额，且明确要求"不挤"
  | 'duplicate'          // 同一条 canonical 连接已存在
  | 'cycle'              // 会形成环
~~~

校验是**按顺序**的，越早失败越早返回。顺序本身就是文档（源码顺序）：

1. 翻正方向；翻不了 → `bad-orientation`。
2. `source` / `target` 里有空串 → `missing-node`。
3. 两端是同一个节点 → `self-loop`。
4. 两端节点要在 `ctx.nodes` 里；不在就是 `missing-node`（除非开了 `allowMissingNodes`）。
5. 源类型声明了 `outputs: []`（空数组）→ `no-source-port`。**没声明 `outputs` = 默认有输出口。**
6. 目标类型同理 → `no-target-port`。
7. 自定义 handle 在声明的端口里精确匹配失败 → `no-source-port` / `no-target-port`。
8. 目标输入口的 `accepts` 不含源类型 → `type-not-accepted`。
9. 源输出口声明了 `contentType`，目标输入口声明了 `acceptsTypes`，而源的内容类型不在其中 → `type-not-accepted`。
10. `wouldCreateCycle` 成立 → `cycle`。
11. `findDuplicate` 找到同一条 → `duplicate`。
12. 目标输入口容量检查（规则见下）。
13. 全过 → `{ ok: true, canonical, reason: 'ok' }`。

### 容量：这里最容易搞反

四条语义，记牢（每一条都是被真实 bug 逼出来的）：

- **不声明 `capacity` = 不限条数。** 想限制才写。
- **`limit: 'single'` 是 `capacity = 1` 的等价写法**（保留兼容）。
- **声明了且已满 → 默认"挤掉最老一条"**（`evictOnFull` 缺省 `true`）：校验这里**放行**，
  "挤哪条"交给 `pickOverflowEvict`。内核只做纯判定，不替调用方决定删哪条。
- **只有显式 `evictOnFull: false`** 才满额直接拒 → `limit-reached`。

还有一条细节：**容量只统计"连到同一个输入口"的现有边**（纯具名多端口类型，各口容量独立、互不挤占）。
默认口（无具名）归一为 `'target'` —— 真实拖拽建出的边 `targetHandle` 常常是 `null`，不归一就算不对。

### 声明式连接约束怎么写

约束写在**节点类型**上，不写在连接代码里。字段的单一来源是 `nodeStore.ts` 的 `PortDef`，
连接校验直接复用它（`connection.ts` 里 `export type { PortDef }` 再导出，不重复定义）：

~~~ts
// 文件：packages/canvas-data/src/nodeStore.ts
// 格式：TypeScript 模块（PortDef 逐字摘录）
// 位置：端口约束的单一来源；节点类型注册时声明

export interface PortDef {
  /** 'target'(输入) / 'source'(输出)；填自定义名就是多端口 */
  port?: string
  /** 该端口接受的**源节点类型**列表；缺省 / 空 = 来者不拒 */
  accepts?: string[]
  /** 'single' = 该端口只允许一条连接；缺省 = 多条 */
  limit?: 'single' | 'multi'
  /** 输出口产出 / 输入口接收的**内容类型** */
  contentType?: string
  /** 输入口接受的内容类型列表 */
  acceptsTypes?: string[]
  /** 输入口最多接几条入边。**不声明 = 不限条数**，只有确实要限制时才写 */
  capacity?: number
  /** 容量满时是否允许"先挤掉最老一条再加新边"。**缺省 true**（默认就是挤） */
  evictOnFull?: boolean
}
~~~

四种真实写法（都来自仓库里的插件，可直接对照）：

~~~ts
// 文件：几个真实插件里的连接声明，集中摘录
// 格式：TypeScript 模块（ctx.nodes.register 的片段）
// 位置：节点类型注册处 —— 连接规则就在这里声明

// ① 图片节点：不写 capacity = 不限条数
//    packages/plugins/plugin-node-image/src/nodeImagePlugin.ts
inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
outputs: [{ port: 'source', contentType: 'image' }],

// ② 3D 预览：只接一张图，满了自动挤掉原先那张（缺省 evictOnFull = true）
//    packages/plugins/plugin-node-3d-preview/src/node3dPreviewPlugin.ts
inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 1 }],
outputs: [],   // 空数组 = 没有输出口（别人连不上它的下游）

// ③ 图片对比：只收图片，容量 2
//    packages/plugins/plugin-node-image-compare/src/nodeImageComparePlugin.ts
inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 2 }],
outputs: [],

// ④ 视频节点：图片 / 文本 / 视频都能当它的上游
//    packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts
inputs: [{ port: 'target', acceptsTypes: ['image', 'text', 'video'] }],
outputs: [{ port: 'source', contentType: 'video' }],
~~~

> **`outputs: []` 和"不写 `outputs`"是相反的意思**：前者是"我没有输出口"，后者是"我默认有口"（旧语义）。
> 这两个是项目里最容易搞反的一条，`plugin-node-image-compare` 与 `plugin-node-3d-preview` 都靠 `outputs: []` 表达"终点型节点"。

### 中间态元素不参与判定

"中间态" = 为了完成一次交互而临时出现在画布上的节点/边（典型：拖线落空白时那张"待选择"菜单卡 + 占位连线）。
判定收在一处：`packages/canvas-data/src/transient.ts` 的 `isTransient(el)` —— 读 `data.transient === true`，
缺省回退老标记 `data.isTemp === true`。

**环检测、重复检测、容量统计全部忽略中间态边。** 否则拖线过程中的占位线会被算成"已存在一条"，
落下时就变成"已存在同一条连线"。

## 会在哪里用到

| 谁 | 在哪 | 用它干什么 |
| --- | --- | --- |
| **加边唯一写口** | `packages/canvas-data/src/graphDocument.ts` | `connectEdge` 先 `validateConnection`，再 `pickOverflowEvict` 腾位，最后落边 |
| 渲染宿主拖线 | `packages/canvas-render/src/host/CanvasHost.vue` | `checkConnection(...)` 包一层喂 `ValidateContext`；已提交的边**幂等放行** |
| 拖线反馈 | `packages/canvas-render/src/connection/resolveFeedback.ts` | 拖线 hover 时判"合法 / 非法"两态 |
| 中文文案 | `packages/canvas-render/src/connection/reasonText.ts` | `reasonText(reason)` 把原因码翻成"不能连自己"这类句子 |
| 多选批量连 | `packages/plugins/plugin-multi-select/src/SelectionFrame.vue` | 用同一个 `validateConnection` 预筛候选，避免"单条能连、批量被拒" |
| 右键建节点菜单 | `packages/plugins/plugin-context-menu/src/connectionMenu.ts` | 把"待建节点"当占位节点塞进节点表预筛可建类型 |
| 边外观 / 选择集能力 | `packages/canvas-render/src/connection/capability.ts` | 内容类型 + 容量的**展示侧**判定（与内核判定互补，不重复） |

## 完整例子

下面这个小插件做三件事：**声明一个端口很挑剔的节点类型**、**自己跑一遍校验并处理结果**、
**做一条"把选中节点连给某个目标"的命令**（顺带演示满额挤出的返回值）。

同样的文件在仓库里也放了一份，可直接打开对照：
`packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/`。

### 目录树

~~~
plugin-conn-demo/
├── package.json            # 清单：包名 / 入口 / miniCanvas 元信息
└── src/
    ├── index.ts            # 插件入口：注册节点类型 + 两条命令（校验 / 批量连）
    ├── connRules.ts        # 从 doc 组装 ValidateContext 的小助手（校验的输入从哪来）
    └── __tests__/
        └── connRules.test.ts   # Node 单测：把每种失败原因都点一遍
~~~

### `package.json`（全文）

~~~json
{
  "name": "@mini-canvas/plugin-conn-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "演示：连接规则",
    "description": "声明式端口约束 + 自己跑一遍连接校验，把每种失败原因都演示出来",
    "pluginName": "conn-demo",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/kernel": "workspace:*"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
~~~

### `src/connRules.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/connRules.ts
// 格式：TypeScript 模块（纯逻辑小助手）
// 位置：把 doc 的当前状态组装成连接校验要的 ValidateContext

import { typeConnectionDef, validateConnection } from '@mini-canvas/canvas-data'
import type { ConnectionInput, DocService, ValidateContext, ValidationResult } from '@mini-canvas/canvas-data'

/**
 * 从 doc 现场组装校验上下文。
 *
 * 为什么要这么写：validateConnection 是**纯函数** —— 它不碰任何实例，
 * 现存节点、现存边、类型声明都得由调用方喂进去。这样它能在 Node 里被一条条测。
 */
export function contextFromDoc(doc: DocService): ValidateContext {
  return {
    nodes: new Map(doc.getNodes().map((n) => [n.id, { id: n.id, type: n.type }])),
    edges: doc.getEdges(),
    // 类型声明从 doc 的类型表反查 —— typeConnectionDef 负责"没声明就给 undefined"
    getTypeConn: (type) => typeConnectionDef(doc.types.get(type)),
  }
}

/** 校验一条候选连接；返回原样的 ValidationResult（含 canonical，供直接建边） */
export function checkEdge(doc: DocService, conn: ConnectionInput): ValidationResult {
  return validateConnection(conn, contextFromDoc(doc))
}

/** 原因码 → 人话（渲染层有一份更全的 reasonText；这里只演示映射思路） */
const TEXT: Record<string, string> = {
  'missing-node': '两端节点不存在',
  'self-loop': '不能连自己',
  'bad-orientation': '连接方向有误',
  'no-source-port': '源节点没有输出口',
  'no-target-port': '目标节点没有输入口',
  'type-not-accepted': '类型不匹配',
  'limit-reached': '已达连接上限',
  duplicate: '已存在同一条连线',
  cycle: '会形成环',
}

export function describe(result: ValidationResult): string {
  if (result.ok) return '可以连'
  return TEXT[result.reason] ?? result.reason
}

/** 从节点表里找两个不同类型的节点，演示"类型不匹配"是怎么被挡下的 */
export function findPair(doc: DocService, sourceType: string, targetType: string) {
  const nodes = doc.getNodes()
  return {
    source: nodes.find((n) => n.type === sourceType)?.id,
    target: nodes.find((n) => n.type === targetType)?.id,
  }
}
~~~

### `src/index.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { checkEdge, describe } from './connRules'

export const name = 'conn-demo'
// 硬依赖 doc（数据）与 selection（要给选中的节点连线）
export const inject = ['doc', 'selection'] as string[]

export function apply(ctx: Context) {
  const doc = ctx.get<DocService>('doc')

  // ① 一个只接一张图的终点型节点：满了自动挤掉原先那张（capacity: 1 + 缺省 evictOnFull）。
  //    outputs: [] 表示它是终点 —— 别人连不上它的下游。
  ctx.nodes.register({
    type: 'badge',
    label: '徽章',
    size: { w: 200, h: 120 },
    nameTemplate: '徽章 {{ID}}',
    inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 1 }],
    outputs: [],
    // 数据层不认识组件：这里只声明数据那半边，展示留给渲染层 / 主题
  })

  // ② 一条命令：检查选中前两个节点能不能连，并打印结论
  ctx.commands.register({
    id: 'conn-demo:check',
    title: '连线检查：选中两个看看',
    run: () => {
      const ids = [...ctx.get<{ ids: Set<string> }>('selection').ids]
      if (ids.length < 2) {
        console.log('[conn-demo] 先选中两个节点')
        return false
      }
      const result = checkEdge(doc, { source: ids[0]!, target: ids[1]! })
      console.log('[conn-demo] ' + describe(result))
      if (result.ok && result.canonical) {
        // 通过时拿 canonical（翻正后的端点）去建边，而不是拿原始入参
        const r = doc.connectEdge({ source: result.canonical.source, target: result.canonical.target })
        console.log(
          '[conn-demo] 落边结果：' + r.status +
            (r.evictedEdgeId ? '，挤掉了 ' + r.evictedEdgeId : ''),
        )
      }
      return result.ok
    },
  })

  // ③ 一条命令：把每个选中节点都连到第一个徽章节点上。
  //    逐条连时会自然演示两条真实规则：
  //      · 同一个源连两次 → duplicate（已存在，幂等跳过）
  //      · 第三个不同的源 → ok 且带 evictedEdgeId（capacity: 1 满额挤最老）
  ctx.commands.register({
    id: 'conn-demo:connect-all-to-badge',
    title: '连线：把选中节点都接到徽章上',
    run: () => {
      const badge = doc.getNodes().find((n) => n.type === 'badge')
      if (!badge) {
        console.log('[conn-demo] 先建一个徽章节点')
        return false
      }
      const ids = [...ctx.get<{ ids: Set<string> }>('selection').ids].filter((id) => id !== badge.id)
      // 一次事务：整批连线算一条撤销 —— 想 undo 就整批一起退
      doc.transaction('conn-demo:connect-all', (tx) => {
        for (const id of ids) {
          const r = tx.connectEdge({ source: id, target: badge.id })
          console.log(
            '[conn-demo] ' + id + ' → ' + badge.id + '：' + r.status +
              (r.reason ? '（' + r.reason + '）' : '') +
              (r.evictedEdgeId ? '，挤掉 ' + r.evictedEdgeId : ''),
          )
        }
      })
      return true
    },
  })
}
~~~

### `src/__tests__/connRules.test.ts`（全文）

~~~ts
// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/__tests__/connRules.test.ts
// 格式：TypeScript 测试（vitest，environment: 'node'）
// 位置：连接规则的逐条验证 —— 纯函数，不需要浏览器

import { describe, expect, it } from 'vitest'
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { DocService } from '@mini-canvas/canvas-data'
import { checkEdge } from '../connRules'
import * as connDemo from '../index'

async function boot() {
  const ctx = new Context({ dev: true })
  ctx.plugin(createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() }).plugin)
  ctx.plugin(connDemo)
  await ctx.start()
  const doc = ctx.get<DocService>('doc')
  // 造一个图片节点当上游（只声明产出 image，不需要任何组件）
  doc.registerType({
    type: 'image',
    label: '图片',
    defaultSize: { w: 320, h: 240 },
    outputs: [{ port: 'source', contentType: 'image' }],
  })
  return { ctx, doc }
}

describe('连接校验（纯函数，Node 可测）', () => {
  it('类型不接 → type-not-accepted；接图片 → ok，且第二次是 duplicate', async () => {
    const { doc } = await boot()
    const img = doc.createNode('image', { x: 0, y: 0 })
    const badge = doc.createNode('badge', { x: 300, y: 0 })

    // 造一个文本节点当“类型不匹配”的源
    doc.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 80 } })
    const txt = doc.createNode('text', { x: 0, y: 200 })

    expect(checkEdge(doc, { source: txt, target: badge }).reason).toBe('type-not-accepted')
    expect(checkEdge(doc, { source: img, target: badge }).ok).toBe(true)

    // 真的连上以后再查，就是重复了
    doc.connectEdge({ source: img, target: badge })
    expect(checkEdge(doc, { source: img, target: badge }).reason).toBe('duplicate')
  })

  it('徽章没有输出口 → 连它的下游是 no-source-port', async () => {
    const { doc } = await boot()
    const badge = doc.createNode('badge', { x: 0, y: 0 })
    const img = doc.createNode('image', { x: 300, y: 0 })
    expect(checkEdge(doc, { source: badge, target: img }).reason).toBe('no-source-port')
  })

  it('自己连自己 → self-loop', async () => {
    const { doc } = await boot()
    const img = doc.createNode('image', { x: 0, y: 0 })
    expect(checkEdge(doc, { source: img, target: img }).reason).toBe('self-loop')
  })

  it('capacity: 1 满额时放行（挤老边），connectEdge 返回 evictedEdgeId', async () => {
    const { doc } = await boot()
    const a = doc.createNode('image', { x: 0, y: 0 })
    const b = doc.createNode('image', { x: 0, y: 200 })
    const badge = doc.createNode('badge', { x: 400, y: 0 })
    doc.connectEdge({ source: a, target: badge })
    const second = doc.connectEdge({ source: b, target: badge })
    expect(second.status).toBe('ok')
    // 满额默认挤掉最老一条（FIFO），而不是拒
    expect(second.evictedEdgeId).toBeTruthy()
    expect(doc.getEdges()).toHaveLength(1)
  })
})
~~~

## 常见坑

1. **canonical 是翻正后的端点，建边要用它。**
   用户可以从 target 往 source 反着拖，校验内部会自动翻正；返回的 `canonical` 才是规范方向。
   直接用原始入参建边的话，图上会出现一条反向的边，后续环检测、去重都会算不准。

2. **`outputs: []` 与不写 `outputs` 意思相反。**
   空数组 = 明说"我没有输出口"，别人连它的下游会拿到 `no-source-port`；不写 = 默认有口。
   这个反直觉的地方最常被写错，而且写错时往往看起来"功能正常"，直到有人试着连它的下游。

3. **不声明 `capacity` 就是不限条数，不是"默认 1"。**
   这是被真实 bug 逼出来的语义（老实现把"不声明"当 1）。反过来，要限制就必须显式写 `capacity`，
   而且满额时的缺省行为是**挤掉最老一条**而不是拒 —— 结果里会带 `evictedEdgeId`，
   想"满额直接拒"得显式 `evictOnFull: false`。

4. **`allowMissingNodes` 只该给载入历史边用。**
   刷新恢复、云端合并这类场景里，两端节点可能还没进索引，放行才不会把历史边误判丢掉。
   手动拖线时两端必然在图上，开了反而会漏掉真正的"目标不存在"。

5. **别自己写"为什么连不上"的文案。**
   渲染层已有 `reasonText(reason)`（`packages/canvas-render/src/connection/reasonText.ts`）
   把原因码翻成中文（`self-loop → 不能连自己`）。自己拼一套的结果是同一个原因在界面上有两句话。

6. **别在别的文件里再抄一份容量判定。**
   `pickOverflowEvict` 的注释明确写着"唯一的实现，别在别处再抄一份" ——
   这条判定漂移过一次（拖线能连、批量连被拒），代价是排查一整天。

