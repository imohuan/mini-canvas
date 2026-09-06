# 连接校验内核：connection（环检测 / 重复边 / 声明式约束 / 归一化）

> 来源：packages/canvas-core-v2/src/services/connection.ts

把 v1 的 `useCanvasConnection` + `ConnectionValidator` 的严格校验**原样吸收**进内核成一组纯函数 + 一个校验服务，零 Vue、可 Node 单测。宿主拖线时用它判定"这条线能不能连"。

---

## 1. 两条基本概念（先说人话）

- **朝向**：一条连接有方向。规范里"输出端(source 口) 在 source 节点、输入端(target 口) 在 target 节点"叫 **canonical**（正规方向）。反着拖会被自动翻正；两个口在同侧就非法。
- **canonical 端点对** = `{ source, target }`：source 是输出端、target 是输入端。

---

## 2. 输入形状

```ts
interface ConnectionInput {          // 与 VueFlow Connection 同构
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}
interface ExistingEdge {             // 已存在的边（v2 以最小形状传入即可比较）
  source: string; sourceHandle?: string | null
  target: string; targetHandle?: string | null
  data?: { isTemp?: boolean }        // isTemp 边（临时拖线预览）在部分规则里被忽略
}
```

---

## 3. 纯函数（各自独立可测）

### 3.1 normalizeConnection —— 缺 handle 归一

```ts
normalizeConnection({ source: 'a', target: 'b' })
// => { source:'a', sourceHandle:'source', target:'b', targetHandle:'target' }
```
缺 handle 归一成 `'source'` / `'target'`。

### 3.2 toCanonicalConnection —— 翻成统一方向

```ts
toCanonicalConnection({ source:'a', sourceHandle:'source', target:'b', targetHandle:'target' })
// => { source:'a', target:'b' }        （本来就正规）
toCanonicalConnection({ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' })
// => { source:'a', target:'b' }        （反接自动翻正）
toCanonicalConnection({ source:'a', sourceHandle:'source', target:'b', targetHandle:'source' })
// => null                              （同侧非法）
```
只接受 `source→target` 或反接翻正；其它朝向返回 `null`。

### 3.3 getCanonicalEndpoints —— 已有边翻正

把一条 `ExistingEdge` 也归一成 canonical（缺 handle 同 `toCanonical` 语义）。

```ts
getCanonicalEndpoints({ source: 'a', target: 'b' })                  // { source:'a', target:'b' }
getCanonicalEndpoints({ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' }) // { source:'a', target:'b' }
```

### 3.4 wouldCreateCycle —— DFS 环检测

判断"补一条 source→target 会不会成环"。从 target 沿现有正向边 DFS，能走回 source 即成环。

```ts
wouldCreateCycle('a', 'b', [])                       // false（无边）
wouldCreateCycle('a', 'b', [{ source:'b', target:'a' }])  // true（b→a 已存在，补 a→b 成环）
wouldCreateCycle('a', 'a', [])                       // true（自连）
wouldCreateCycle('a', 'b', [{ source:'b', target:'a', data:{ isTemp:true } }])  // false（isTemp 不算）
```

### 3.5 isSameConnection / findDuplicate —— 重复边检测

同一条 canonical 连接只允许一条（忽略 isTemp）。

```ts
isSameConnection({ source:'a', target:'b' }, { source:'a', target:'b' })        // true
findDuplicate({ source:'a', target:'b' }, [{ source:'a', target:'b' }])         // 该边
findDuplicate({ source:'a', target:'b' }, [{ source:'b', sourceHandle:'target', target:'a', targetHandle:'source' }]) // 反接也算重复 → 返回该边
findDuplicate({ source:'a', target:'b' }, [{ source:'a', target:'b', data:{isTemp:true} }]) // undefined（isTemp 不算）
```

---

## 4. validateConnection —— 一条连接的完整校验

`validateConnection(conn, ctx, opts)` 返回 `ValidationResult`：

```ts
interface ValidationResult {
  ok: boolean
  reason: InvalidReason | 'ok'
  canonical?: CanonicalEndpoints   // 通过时给规范化端点（供建边）
}
type InvalidReason =
  | 'missing-node' | 'self-loop' | 'bad-orientation'
  | 'no-source-port' | 'no-target-port' | 'type-not-accepted'
  | 'limit-reached' | 'duplicate' | 'cycle'
```

校验上下文：

```ts
interface ValidateContext {
  nodes: Map<string, { id: string; type: string }>        // 现存节点
  edges: ExistingEdge[]                                    // 已有边（含 isTemp 标记）
  getTypeConn: (type: string) => NodeConnectionDef | undefined  // 由 type 反查连接声明
}
```

### 完整例子

```ts
import { validateConnection } from '@mini-canvas/canvas-core-v2'

const res = validateConnection(
  { source: 'a', sourceHandle: 'source', target: 'b', targetHandle: 'target' },
  {
    nodes: new Map([
      ['a', { id: 'a', type: 'text' }],
      ['b', { id: 'b', type: 'image' }],
    ]),
    edges: [],
    getTypeConn: (t) => typeConn[t],
  },
)
if (res.ok) {
  const { source, target } = res.canonical!   // 拿来建边
  edgeStore.addEdge({ source, target })
} else {
  console.log('连不上，原因：', res.reason)
}
```

### 校验顺序（源码，越早失败越先返回）

1. `toCanonicalConnection` 翻正；翻不了 → `bad-orientation`。
2. source/target 空 → `missing-node`。
3. source === target → `self-loop`。
4. 两端节点要存在（`allowMissingNodes:false` 时）；不在 → `missing-node`。
   - **`allowMissingNodes: true`** 时放行（模拟刷新载入历史边、两端暂不在索引，避免误丢）。
5. 源类型 `outputs` 存在且非空才算有 source 口；否则 `no-source-port`（未声明 outputs 默认都有口）。
6. 目标类型同理 → `no-target-port`。
7. **声明式 accepts**：目标 `inputs` 里 port='target'（或缺省）那项的 `accepts` 若限定源类型且不含 source.type → `type-not-accepted`。
8. `wouldCreateCycle` → `cycle`。
9. `findDuplicate` → `duplicate`。
10. 目标 input `limit:'single'` 且已有一条入边 → `limit-reached`。
11. 全过 → `{ ok: true, canonical, reason: 'ok' }`。

---

## 5. 声明式连接约束（nodeStore 类型定义里）

`NodeConnectionDef` / `PortDef`：

```ts
interface PortDef {
  port?: string            // 'target'(输入) / 'source'(输出)
  accepts?: string[]       // 该端口接受的源节点类型；缺省/空 = 来者不拒
  limit?: 'single' | 'multi'  // 'single' = 只许一条入边
}
interface NodeConnectionDef { inputs?: PortDef[]; outputs?: PortDef[] }
```

`typeConnectionDef(def)` 便捷反查：无 inputs/outputs 返回 undefined（默认人人可连）。

```ts
import { typeConnectionDef } from '@mini-canvas/canvas-core-v2'
typeConnectionDef({ inputs: [{ accepts: ['text'] }] })   // 有声明
typeConnectionDef({})                                    // undefined（默认都可连）
```

```ts
// 例子：image 类型的输入口只接 'image' 源、且 single
// 在注册类型时声明：
nodeStore.registerType({
  type: 'mask', label: '遮罩', defaultSize: { w: 100, h: 100 },
  inputs: [{ port: 'target', accepts: ['image'], limit: 'single' }],
})
```

---

## 6. 坑与速记

1. **canonical = source 是输出端、target 是输入端**；validate 内部自动翻正反接，返回的 `canonical` 是翻正后的（用它建边）。
2. **isTemp 边**（临时预览）：环检测、重复检测都**忽略** isTemp。
3. 声明了 `outputs: []`（空数组）= 没有输出口 → `no-source-port`；**不声明** outputs = 默认有 source+target 口。别搞反。
4. `accepts` 为空/未声明 = 来者不拒。
5. `allowMissingNodes: true` 只用于"载入历史边，两端暂不在索引"的兜底；手动拖线两端必在，通常别开。
6. limit 检测只在输入口：目标已有任意一条 canonical 入边就拒（无论源是谁）。
7. 校验是**纯函数**，不管 nodeStore/edgeStore 实例——调用方负责构造 `ValidateContext`（把现存节点/边喂进去）。
