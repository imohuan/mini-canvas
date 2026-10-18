# 上游与执行顺序

**一句话定位**：`upstream` 能力回答三件事 —— **我这个节点连进来的是谁**、**整条依赖链有多深**、
**从最后一个节点倒推时该按什么顺序执行**。

**它属于哪一块**：纯逻辑在 `packages/canvas-data/src/canvas/upstreamGraph.ts`，
能力实现在 `packages/canvas-render/src/contracts/standardCapabilities.ts`（注册进 `registryOf('capability')`）。
前端与后台共用同一份纯函数。

## 它是什么

上游不是只有一层。A → B → C 里，C 的上游是 B，B 的上游是 A；
执行插件从 C 开始倒推，需要拿到 `[A, B, C]` 这个顺序。

~~~
上游图片 ──▶ 滤镜 ──▶ 合成 ──▶ 输出
   A          B        C        D
                      └─ 分叉时还要去重（菱形依赖只执行一次）
~~~

## 怎么用

### 读直接上游

~~~ts
const upstream = useCapability<UpstreamCapability>('upstream')

upstream.nodes()              // 直接上游（边 source → 本节点 target）
upstream.ofType('image')      // 直接上游里产出 image 的那些
upstream.media('image')       // 某个 consumes 槽的第一张图（只给 resourceId）
upstream.media('image', 1)    // 同槽第二个候选（左右对比用 0/1）
upstream.text('\n')           // 上游文本按边序拼接
~~~

### 继续往上读（无限层）

每个 `UpstreamNode` 自己也能继续取上游，所以“上游的上游”不需要额外 API：

~~~ts
const parents = upstream.nodes()
const grandParents = parents[0]?.upstream()      // 再上一层
const all = upstream.nodes()[0]?.ancestors()      // 整条祖先链（去重，不含自己）
const depth = upstream.nodes()[0]?.depth()        // 到最远祖先的层数
~~~

实现是**迭代 + 已访问集合**，不是递归：三层、十层、上百层都不会爆栈；
有环时按 `{ cycle: 'skip' | 'error' }` 处理。

### 从末端倒推执行顺序

~~~ts
const plan = upstream.order()          // ['A', 'B', 'C']：最早依赖在前，当前节点最后
for (const id of plan) await runNode(id)

const nodes = upstream.closure()       // 同上，但返回 UpstreamNode（能读 outputs）
~~~

| 选项 | 默认 | 说明 |
|---|---|---|
| `includeTransient` | `false` | 是否包含拖线占位卡等中间态 |
| `includeGroups` | `false` | 是否把分组容器当作数据源（默认跳过，子节点仍参与） |
| `maxDepth` | 不限 | 最多向上几层 |
| `cycle` | `'skip'` | 有环时跳过回边；`'error'` 抛出并列出环上 id |

### 执行插件的最小骨架

~~~ts
// 节点自己的 execute：读上游 → 调工具/模型 → 写回自己的 produces
async function runNode(id: string) {
  const up = upstreamFor(id)
  const input = up.media('image')                 // 只拿 resourceId
  const url = await media.resolve(input.resourceId)
  const output = await callModel(url)
  const resourceId = await media.put(output.blob, { kind: 'image' })
  doc.updateNode(id, { data: { resourceId } })    // 只写 ID
}

// 调度：从末端节点倒推，按拓扑序逐个执行
const order = upstreamFor(lastNodeId).order({ cycle: 'error' })
for (const id of order) await runNode(id)
~~~

失败语义建议：某个节点抛错 → 停止后续、当前标 `failed`、未执行标 `pending`；
重试从失败节点开始，已完成节点不重跑（除非用户显式“全部重跑”）。

## 前端与后台共用

遍历只依赖“节点表 + 边表”：

| 环境 | 怎么拿图 |
|---|---|
| 前端 | `{ nodes: doc.getNodes(), edges: doc.getEdges() }` |
| 后台 | `const snap = await canvasDoc.read(); { nodes: snap.nodes, edges: snap.edges }` |

两边都调 `collectAncestors` / `topoOrderFrom`，因此“前端看到的依赖链”和“后台执行器算出的顺序”一致。

## 常见坑

1. **方向别搞反**：canonical 是 `source` 节点为输出端、`target` 节点为输入端；
   `upstream.nodes()` 找的是 `edge.target === 本节点`。
2. **不要自己扫 `doc.getEdges()`**：字段名、分组、中间态、环检测各写一遍必然漂移；
   统一走能力。
3. **不要按槽名拆左右**：图片对比的左右是同一个 `image` 槽的第 0/1 个候选，
   用 `media('image', 0)` / `media('image', 1)`；拆成两个 `consumes` 槽会命中同一个上游。
4. **拓扑序是稳定的**：同一张图多次调用结果一致；不要依赖 Map 的迭代顺序。

