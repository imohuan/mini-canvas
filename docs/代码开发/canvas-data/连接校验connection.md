# 连接校验：connection（环检测 / 重复边 / 声明式约束 / 容量）

> 来源：`packages/canvas-data/src/canvas/connection.ts`、`packages/canvas-data/src/nodeStore.ts`（`PortDef`）、
> `packages/canvas-data/src/graphDocument.ts`（加边守门人）、`packages/canvas-data/src/transient.ts`、
> `packages/canvas-render/src/connection/reasonText.ts`、`packages/canvas-render/src/host/CanvasHost.vue`

把老版的严格校验吸收进数据层，做成一堆**纯函数**加一个校验函数 —— 零 Vue，可在 Node 里单测。
宿主拖线时用它判定"这条线能不能连"；加边时它也是唯一守门人。

---

## 1. 先讲清两个概念

- **朝向**：一条连接有方向。规范里"输出端（`source` 口）在 source 节点、输入端（`target` 口）在 target 节点"
  叫 **canonical**（正规方向）。反着拖会被自动翻正；两个口在同侧就非法。
- **canonical 端点对** = `{ source, target }`：source 是输出端、target 是输入端。

另外有个**中间态**概念贯穿全篇：拖线途中的占位节点 / 占位边不是用户作品，打标后不被当成正式元素。
判定在 `packages/canvas-data/src/transient.ts` 的 `isTransient(el)`：读 `data.transient === true`，
缺省回退老标记 `data.isTemp === true`。**环检测、重复检测、容量统计全部忽略中间态边。**

---

## 2. 输入形状

```ts
interface ConnectionInput {          // connection.ts:21（与 VueFlow Connection 同构）
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}
interface ExistingEdge {             // connection.ts:29（已有边，最小形状即可比较）
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  data?: { isTemp?: boolean }
}
```

---

## 3. 纯函数（各自独立可测）

### 3.1 normalizeConnection —— 缺 handle 归一（`connection.ts:92`）

```ts
normalizeConnection({ source: 'a', target: 'b' })
// => { source:'a', sourceHandle:'source', target:'b', targetHandle:'target' }
```

缺 handle 归一成 `'source'` / `'target'`。

### 3.2 toCanonicalConnection —— 翻成统一方向（`connection.ts:106`）

```ts
toCanonicalConnection({ source:'a', sourceHandle:'source', target:'b', targetHandle:'target' })
// => { source:'a', target:'b' }        （本来就正规）
toCanonicalConnection({ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' })
// => { source:'a', target:'b' }        （反接自动翻正）
toCanonicalConnection({ source:'a', sourceHandle:'source', target:'b', targetHandle:'source' })
// => null                              （同侧非法）
```

**多端口补充**：两端都是**自定义**端口名（非 `source`/`target`）时，无法只凭字符串判方向，
按调用侧约定视为正向（source 节点 = 输出端），不翻转；端口是否真实存在由声明去校验。
一端默认一端自定义混用 → 仍按默认 `source`/`target` 判定。

### 3.3 getCanonicalEndpoints —— 已有边翻正（`connection.ts:119`）

把一条 `ExistingEdge` 也归一成 canonical（缺 handle 语义同上）；翻不了返回 `null`。

```ts
getCanonicalEndpoints({ source: 'a', target: 'b' })   // { source:'a', target:'b' }
getCanonicalEndpoints({ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' })
// => { source:'a', target:'b' }
```

### 3.4 wouldCreateCycle —— DFS 环检测（`connection.ts:132`）

判断"补一条 source→target 会不会成环"：从 target 沿现有**正向**边 DFS，能走回 source 即成环。
忽略中间态边。

```ts
wouldCreateCycle('a', 'b', [])                                 // false（无边）
wouldCreateCycle('a', 'b', [{ source:'b', target:'a' }])       // true（b→a 已有，补 a→b 成环）
wouldCreateCycle('a', 'a', [])                                 // true（自连）
wouldCreateCycle('a', 'b', [{ source:'b', target:'a', data:{ isTemp:true } }])  // false（中间态不算）
```

### 3.5 isSameConnection / findDuplicate —— 重复边检测（`connection.ts:158` / `165`）

同一条 canonical 连接只允许一条（忽略中间态）。

```ts
isSameConnection({ source:'a', target:'b' }, { source:'a', target:'b' })   // true
findDuplicate({ source:'a', target:'b' }, [{ source:'a', target:'b' }])    // 该边
findDuplicate({ source:'a', target:'b' },
  [{ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' }])  // 反接也算重复 → 该边
findDuplicate({ source:'a', target:'b' }, [{ source:'a', target:'b', data:{isTemp:true} }])  // undefined
```

### 3.6 resolveTargetInputPort / resolveSourceOutputPort —— 端口解析（`connection.ts:281` / `300`）

从类型声明里解析出"这次连接实际用的是哪个口"（多端口用）。

- handle 缺省 / `null` / `'target'`（源侧 `'source'`）→ 取**默认口**：
  优先未命名或名为 `target`（源侧 `source`）的那条，纯具名多端口类型则退回第一个口；
- handle 是自定义名 → 在 `inputs`（`outputs`）里按 `port === handle` **精确匹配**，未命中返回 `undefined`；
- 类型没声明 `inputs`（`outputs`）→ 返回 `undefined`。

### 3.7 typeConnectionDef —— 从类型定义反查连接声明（`connection.ts:314`）

```ts
typeConnectionDef({ inputs: [{ accepts: ['text'] }] })   // 有声明 → { inputs, outputs }
typeConnectionDef({})                                    // undefined（默认人人可连）
```

---

## 4. validateConnection —— 一条连接的完整校验（`connection.ts:177`）

```ts
validateConnection(conn, ctx, opts?) : ValidationResult

interface ValidationResult {          // connection.ts:80
  ok: boolean
  reason: InvalidReason | 'ok'
  canonical?: CanonicalEndpoints       // 通过时给规范化端点（供建边用）
}
type InvalidReason =                    // connection.ts:69
  | 'missing-node' | 'self-loop' | 'bad-orientation'
  | 'no-source-port' | 'no-target-port' | 'type-not-accepted'
  | 'limit-reached' | 'duplicate' | 'cycle'

interface ValidateContext {            // 校验上下文
  nodes: Map<string, { id: string; type: string }>
  edges: ExistingEdge[]
  getTypeConn: (type: string) => NodeConnectionDef | undefined
}
```

### 校验顺序（源码顺序，越早失败越先返回）

1. `toCanonicalConnection` 翻正；翻不了 → `bad-orientation`。
2. source / target 为空 → `missing-node`。
3. source === target → `self-loop`。
4. 两端节点要在 `ctx.nodes` 里；不在就 `missing-node`（除非开了 `allowMissingNodes`）。
5. 源类型声明了 `outputs: []`（空数组）→ `no-source-port`；**没声明 outputs = 默认有口**。
6. 目标类型同理 → `no-target-port`。
7. 自定义 handle 精确匹配失败（类型声明了端口但 handle 不在其中）→ `no-source-port` / `no-target-port`。
8. **声明式 accepts**：目标输入口的 `accepts` 限定源类型且不含 `src.type` → `type-not-accepted`。
9. **声明式内容类型**：源输出口声明了 `contentType`，目标输入口声明了 `acceptsTypes`，
   而源的内容类型不在其中 → `type-not-accepted`。
10. `wouldCreateCycle` → `cycle`。
11. `findDuplicate` → `duplicate`。
12. 目标输入口容量校验（见下）。
13. 全过 → `{ ok: true, canonical, reason: 'ok' }`。

### 4.1 容量语义（这里最容易搞反）

- **不声明 `capacity` = 不限条数**（可以接任意多条上游）；
- `limit: 'single'` 是 `capacity = 1` 的等价写法（保留兼容）；
- 声明了 `capacity` 且**已满**：默认**挤掉最老一条**（`evictOnFull` 缺省 `true`），
  校验这里**放行**，"挤哪条"由 `pickOverflowEvict` 决定（见 §5）；
- 只有显式 `evictOnFull: false` 才满额直接拒 → `limit-reached`；
- 容量只统计**连到同一个输入口**的现有边（纯具名多端口类型，各口容量独立、互不挤占）。
  默认口（无具名）归一为 `'target'` —— 真实的拖拽边 `targetHandle` 常常是 `null`，归一后才算对。

### 4.2 完整例子

```ts
import { validateConnection, typeConnectionDef } from '@mini-canvas/canvas-data'

const doc = ctx.get('doc')
const res = validateConnection(
  { source: 'a', sourceHandle: 'source', target: 'b', targetHandle: 'target' },
  {
    nodes: new Map([
      ['a', { id: 'a', type: 'text' }],
      ['b', { id: 'b', type: 'image' }],
    ]),
    edges: [],
    getTypeConn: (t) => typeConnectionDef(doc.types.get(t)),
  },
)

if (res.ok) {
  const { source, target } = res.canonical!       // 用翻正后的端点建边
  doc.connectEdge({ source, target })
} else {
  console.log('连不上，原因：', res.reason)
}
```

### 4.3 谁在调用它

- **加边守门人**：`GraphDocument` 的 `connectEdge`（`graphDocument.ts`）用它校验候选边 ——
  任何走 `doc` 的加边都必须过它，插件 / 宿主 / 云端都不能另辟蹊径。
  通过 → 落边；`duplicate` 单独归为 `status: 'duplicate'`（幂等，不算错误）；其余失败 → `status: 'rejected'` + `reason`。
  **例外**：带 `data.transient` 的临时脚手架边跳过校验（它的端点可能还没进 store）。
- **渲染层拖线**：`CanvasHost.vue` 里的 `checkConnection(...)` 包了一层，用当前图状态喂 `ValidateContext`。
  它多做一件事：**已存在的边放行**（VueFlow 每次 `setEdges` 全量重喂会把已提交的边再校验一遍，
  若按"重复"驳回会把已落盘的边丢掉，表现为"拖完线看不见"）。
- **文案**：`reasonText(reason)`（`packages/canvas-render/src/connection/reasonText.ts`）把枚举翻成中文
  （`'self-loop' → '不能连自己'`、`'cycle' → '会形成环'`…），UI 只消费字符串。

---

## 5. 声明式连接约束（写在节点类型上）

端口约束的**单一来源**是 `packages/canvas-data/src/nodeStore.ts` 的 `PortDef`，
`connection.ts` 直接复用（`export type { PortDef }` 再导出，不重复定义）。

```ts
interface PortDef {                     // nodeStore.ts:50
  port?: string                         // 'target'(输入) / 'source'(输出)；自定义名即多端口
  accepts?: string[]                    // 该口接受的**源节点类型**；缺省/空 = 来者不拒
  limit?: 'single' | 'multi'            // 'single' = 只许一条（= capacity 1 的等价写法）
  contentType?: string                  // 输出口产出 / 输入口接收的**内容类型**
  acceptsTypes?: string[]               // 输入口接受的内容类型列表
  capacity?: number                     // 输入口最多接几条入边；不声明 = 不限
  evictOnFull?: boolean                 // 满额时是否挤掉最老一条；缺省 true
}
interface CanvasNodeType {              // nodeStore.ts:79
  type: string
  label: string
  defaultSize: { w: number; h: number }
  inputs?: PortDef[]
  outputs?: PortDef[]
  icon?: unknown
  description?: string
  resizable?: boolean
  frameless?: boolean
  transparent?: boolean
}
```

```ts
// 例：3d 预览的输入口只接一张图（满额默认挤最老）
ctx.nodes.register({
  type: '3d-preview',
  label: '3D 预览',
  size: { w: 320, h: 240 },
  inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 1 }],
  outputs: [],
  in: PreviewContent,
})
```

### 5.1 `pickOverflowEvict` —— 满额该挤哪条（`connection.ts:349`）

纯函数，与校验里的容量段**严格对齐**（唯一实现，别在别处再抄一份）：

```ts
pickOverflowEvict({ typeConn, edges, target, targetHandle }) : string | null
```

- 没声明 `capacity`（不限）→ `null`；
- 声明了但**没满** → `null`；
- 满了且 `evictOnFull !== false` → 返回**最老一条**入边的 id（FIFO，按边数组序）；
- `evictOnFull === false` → `null`（这种情况校验已直接拒了，轮不到它）。

抽成共享函数的理由很实在：这条决策以前散在渲染宿主一份、插件里各一份（`image-compare` 甚至声明
"上限 +1" 来绕开内核），判定分散就是行为漂移 —— 也正是"同一条边拖过去能连、框选批量连却被拒"的根因。

---

## 6. 坑与速记

1. **canonical = source 是输出端、target 是输入端**；校验内部自动翻正，返回的 `canonical` 是翻正后的，**用它建边**。
2. **中间态边**（`data.transient`，老标记 `data.isTemp`）：环检测、重复检测、容量统计**全部忽略**。
3. 声明了 `outputs: []`（空数组）= 没有输出口 → `no-source-port`；**不声明** outputs = 默认有 source + target 口。别搞反。
4. `accepts` / `acceptsTypes` 为空或未声明 = 来者不拒。
5. `allowMissingNodes: true` 只给"载入历史边、两端暂不在索引"的兜底用；手动拖线两端必在，通常别开。
6. **不声明 `capacity` 就是不限条数**（这是被真实 bug 逼出来的语义：老实现把"不声明"当 1 用，
   于是图片 / 文本这类本该接多个上游的节点接不了第二条）。要限制才写 `capacity`，满额默认**挤老边**。
7. `limit-reached` 只在**显式** `evictOnFull: false` 时出现；默认行为是挤掉最老一条（结果里带 `evictedEdgeId`）。
8. 校验是**纯函数**，不碰任何实例 —— 调用方负责把"现存节点 / 现存边 / 类型声明"喂进 `ValidateContext`。
9. 想给用户看为什么连不上，别自己拼文案：用渲染层的 `reasonText(reason)`。
