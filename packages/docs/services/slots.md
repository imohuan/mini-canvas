# `slots` · UI 槽

**一句话定位**：**`slots` 是一排"空位子" —— 插件把组件放进某个槽，宿主在固定位置把它渲染出来。**

**它属于哪一档**：**内核内置服务，由画布能力层提供**。用 `@mini-canvas/canvas-base` / `@mini-canvas/canvas-data` 导出的画布版 `Context` 时，能力层把 `SlotRegistry` 建好、作为内置服务登记，于是 `ctx.get('slots')` 与 `ctx.slots` 直接可用。有一个真实差别要知道：`@mini-canvas/kernel` 的纯内核 `Context` 不带它（纯内核只自带 `tools`），这一点有测试锁着，见 `packages/kernel/src/__tests__/kernelBoundary.test.ts`。

## 用法

### 插件侧：三个语法糖方法

```ts
// 往槽里放一个组件，返回这条 occupant 的 id（可拿它撤销）
const id = ctx.slots.register('overlay', {
  id: 'my-overlay',        // 可选；不给时容器自动生成"槽名#序号"形状的 id
  order: 60,               // 可选；越小越靠前
  component: MyOverlay,    // 必填；组件句柄（Vue 组件对象 / SFC 默认导出）
  meta: { title: '我的浮层' },   // 可选；宿主读取时原样透出
})

// 撤掉一条（槽里没有这个 id → 返回 false）
ctx.slots.remove('overlay', id)

// 读某槽当前所有 occupant（按 order 排好），宿主渲染用
ctx.slots.occupants('overlay')
// → [{ id, order, component, meta }, ...]
```

`ctx.slots.register` 的落点是 `slot` 注册场（键 = 槽名），同一条记录也写进 `slots` 服务 —— 两条路读到的是同一份真相。

### 宿主侧：一行渲染一个槽

宿主不用知道槽里有什么，只需要"留位置"。渲染层提供了 `SlotHost` 组件：

```vue
<!-- 片段：宿主模板里的一个位置
     格式：Vue 单文件组件模板
     位置：渲染层的渲染子树之内 -->
<SlotHost slot="overlay" />

<!-- 想加一个新槽，宿主多写一行就多一个可扩展区 -->
<SlotHost slot="mini-map" />
```

`SlotHost` 自己会做三件事：初始读一次 `ctx.slots.occupants(slot)` → 订阅 `ctx:plugin-installed` / `ctx:plugin-uninstalled` 两个事件 → 再订阅底层 `slots` 容器的 `subscribe`（覆盖"运行期不经过插件装卸也改了槽"的情况）。它还会给每个 occupant 的根元素带上 `data-slot-id` / `data-slot-order` 两个属性，方便调试和写 CSS。

真实例子：`packages/canvas-render/src/host/CanvasSurface.vue` 里有一行 `<SlotHost slot="overlay" />`；`packages/ui/src/App.vue` 里有 `<SlotHost slot="mini-map" />` 与 `<SlotHost slot="agent-conversation" />`。

### 容器自己的完整方法（`ctx.get('slots')`）

有些场景（宿主、测试、要订阅刷新）要直接用底层容器。签名逐字来自 `packages/kernel/src/registry/slotRegistry.ts`：

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `add` | `add(slot: SlotName, req: SlotAddRequest): string` | 放一条 occupant；给了已存在的 `id` = 替换那条，否则追加。返回 id |
| `remove` | `remove(slot: SlotName, id: string): boolean` | 移除某条；不存在返回 `false` |
| `list` | `list(slot: SlotName): SlotEntry[]` | 该槽全部 occupant，按 `order` 稳定排序（同 order 保持放入先后） |
| `first` | `first(slot: SlotName): SlotEntry \| undefined` | "单赢家"取法：`order` 最小那条；空槽 `undefined` |
| `get` | `get(slot: SlotName, id: string): SlotEntry \| undefined` | 按 id 精确取一条 |
| `has` | `has(slot: SlotName): boolean` | 该槽现在有没有东西 |
| `slots` | `slots(): SlotName[]` | 当前所有槽名 |
| `ids` | `ids(slot: SlotName): string[]` | 该槽里已占用的 id 列表 |
| `clear` | `clear(slot: SlotName): void` | 清空某槽 |
| `clearByPrefix` | `clearByPrefix(prefix: string): void` | 清空"槽名以某前缀开头"的全部槽（例：注销某类节点时清 `type/` 开头的槽） |
| `subscribe` | `subscribe(listener: () => void): () => void` | 订阅"这个容器变了"；返回取消函数。渲染宿主靠它刷新 |

### 三个形状，一眼对上

```ts
interface SlotEntry {                 // 读出来的一条
  id: string
  order: number
  value: unknown
  meta?: unknown
}

interface SlotAddRequest {            // 放进去的一条（容器层）
  id?: string
  order?: number
  value: unknown
  meta?: unknown
}

// 插件语法糖的请求：把 value 叫 component，并额外允许 meta
interface SlotRegisterReq {
  id?: string
  order?: number
  component: unknown
  meta?: unknown
}
```

## 注意事项

1. **`ctx.get('slots')` 缺服务返回 `undefined`，不抛**。在自带能力层的画布上下文里它恒在；但如果代码跑在纯内核 `new Context()` 或最小 mock 上，读到的就是 `undefined`，接着调 `.register` 就会报"undefined 不是函数"。公共逻辑请用 `ctx.slots.register(...)`（语法糖内部已处理缺服务的情况），或者先 `ctx.tryGet('slots')` 判空。
2. **`order` 的方向是"越小越靠前"**，不是越大越优先。`list()` 按 `order` 升序返回，单赢家取 `order` 最小那条。想顶替别人不要删别人，放一条 `order` 更小的就行 —— 别人还在，卸载你以后自动回退。
3. **同一个 `id` 是替换、不同 `id` 是叠加**。`register({ id: 'demo-badge' })` 调两次不会出两条，第二条替换第一条（这也是热重载能干净生效的原因）。反过来，两次注册用的 id 不同（或都没给 id 靠自动生成），槽里就会多出一条 —— 用户会看到两个一模一样的角标。
4. **槽名是约定，不是枚举**。`SlotName` 就是 `string`：拼错一个字母不会报错，只是"放进去的东西永远不显示"（宿主没渲染那个槽）。所以放之前先看一眼宿主有没有 `<SlotHost slot="这个名字" />`；要加新槽，得和宿主一起加。
5. **`SlotHost` 只负责渲染，不负责摆放**。它明确不做定位 / `pointer-events` / 容器样式 —— 那些是"这个槽长什么样"的问题，归使用方（比如 `overlay` 那层铺满画布）。所以组件写成 `position: absolute` 时要自己知道父容器是谁。

