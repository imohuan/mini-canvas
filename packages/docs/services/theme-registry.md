# `themeRegistry` · 主题表

**一句话定位**：**`themeRegistry` 管的是"画布上看得见的东西由哪个组件来画" —— 节点外壳、连线、背景、设置面板，每一格都有一个"当前赢家"。**

**它属于哪一档**：**画布基础服务**（装上 `canvas-base` 这一件基础插件才有）。类住在 `packages/canvas-data/src/canvas/registry/themeRegistry.ts`，是纯逻辑、零 Vue；由基础插件建好实例、经 `ctx.inject('themeRegistry', …)` 上架（见 `packages/canvas-data/src/canvas/canvasBasePlugin.ts`）。

## 用法

### 插件侧：`ctx.theme` 是语法糖

```ts
// 放一件（最常用）。id 缺省 = 当前插件名 → 同插件重装 = 替换自己那一格
ctx.theme.register('nodeShell', BaseNode)
ctx.theme.register('edge', CustomEdge)
ctx.theme.register('background', DefaultBackground)
ctx.theme.register('edgeDefaultType', 'custom')

// 顶替别人的默认皮：给更小的 order（默认 0，所以 -1 就赢）
ctx.theme.add('background', MyBackground, { order: -1 })

// 撤掉（id 传谁的；缺省语义见下）
ctx.theme.remove('background', 'my-plugin')
```

语法糖的签名（`packages/canvas-data/src/canvas/capabilities.ts`）：

```ts
theme: {
  register(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
  add(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
  remove(slot: ThemeSlot, id: string): void
}
```

两条实现细节值得知道（源码里写得很清楚）：

- `register` 与 `add` 走**同一条落位逻辑**，差别只是调用语义（装载期声明 vs 运行期换皮）。
- 它**同时写两处**：`themeRegistry` 容器（渲染层读赢家）与 `theme` 注册场（自省/诊断读）。过去只写一处，导致"场里读到的"与"实际生效的"不一致。

### 直接拿容器：`ctx.get('themeRegistry')`

给宿主、测试、需要订阅刷新的代码用。签名逐字来自 `packages/canvas-data/src/canvas/registry/themeRegistry.ts`：

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `subscribe` | `subscribe(listener: () => void): () => void` | 订阅"任一 occupant 变了"；返回取消函数。宿主靠它在运行期换皮时自动重装配 |
| `occupants` | `occupants(slot: ThemeSlot): SlotEntry[]` | 某槽全部 occupant，按 `order` 稳定排序（装饰层全量渲染用） |
| `winner` | `winner(slot: ThemeSlot): unknown` | **单赢家**：`order` 最小者的 value；空槽 `undefined` |
| `addOccupant` | `addOccupant(slot: ThemeSlot, req: ThemeOccupantRequest): string` | 放一件（多 occupant 语义）；同 `id` 已存在 = 替换那件。返回 occupant id |
| `removeOccupant` | `removeOccupant(slot: ThemeSlot, id: string): boolean` | 移除某件；不存在 `false` |
| `occupantIds` | `occupantIds(slot: ThemeSlot): string[]` | 某槽已占的 id 列表（诊断/热卸用） |
| `hasOccupant` | `hasOccupant(slot: ThemeSlot): boolean` | 某槽是否存在任意 occupant |
| `register` | `register(slot: ThemeSlot, value: unknown): void` | **兼容旧单值 API**：注册 occupant `id='default', order=0`；已有 default 则**抛错** |
| `get` | `get(slot: ThemeSlot): unknown` | 兼容 API：等于 `winner(slot)` |
| `unregister` | `unregister(slot: ThemeSlot): void` | 兼容 API：注销 `default` occupant（不存在就 no-op） |
| `set` | `set(slot: ThemeSlot, value: unknown): void` | 兼容 API：覆盖式重设 `default` occupant |
| `has` | `has(slot: ThemeSlot): boolean` | 兼容 API：等于 `hasOccupant(slot)` |
| `slots` | `slots(): ThemeSlot[]` | 当前所有有 occupant 的槽名 |

两个形状：

```ts
interface ThemeOccupantRequest {   // addOccupant 的请求
  id?: string                      // 缺省 'default'
  order?: number                   // 缺省 0
  value: unknown
}

interface SlotEntry {              // 读出来的一件（来自内核 SlotRegistry）
  id: string
  order: number
  value: unknown
  meta?: unknown
}
```

### 谁在读（宿主那一侧的顺序）

`packages/canvas-render/src/host/canvasHostCore.ts` 的 `assembleTheme()` 是"装配总台"，它一次读齐：

```ts
nodeShell        = theme?.get('nodeShell')
edge             = theme?.get('edge')
background       = theme?.get('background')
connectionLine   = theme?.get('connectionLine')
edgeDefaultType  = theme?.get('edgeDefaultType') ?? 'custom'
```

其中节点外壳是**四级优先**（自上而下，第一个命中的赢）：

1. 注册场 `node/shell/<type>`（精确）
2. 注册场 `node/shell/*`（通配）
3. 主题槽 `nodeShell:<type>`（某类型自带外壳）
4. 主题槽 `nodeShell`（全局默认壳）

所以"只想给图片节点换壳"有两个办法：给 `nodeShell:image` 槽放一件，或者往 `node/shell/image` 场放一条。

## 注意事项

1. **`ctx.get('themeRegistry')` 缺服务返回 `undefined`，而 `ctx.theme.register` 在缺服务时是"静默跳过"**。语法糖用 `tryGet` 找容器：找不到就只往 `theme` 注册场写一条，不抛错。所以你写了一个换主题插件、装进一个没起画布基础服务的宿主时，表现为"注册成功了但界面没变化"。排查第一步永远是 `ctx.get('themeRegistry')` 是不是 `undefined`。
2. **`order` 越小越赢，不是越大**。默认皮放的都是 `order: 0`；想顶替就给负数（`-1` 足够）。另外记住宿主取的是**单赢家**：你注册三件 `nodeShell`，只有 `order` 最小那件被渲染，另外两件"在但看不见" —— 要全量叠加渲染得用 `occupants()` 那一套（装饰层槽才这么消费）。
3. **`register` 和 `addOccupant` 的"同 id 再注册"行为不一样**。`ctx.theme.register` 缺省 `id` = **你的插件名**，所以同一插件重复注册是**替换自己那一格**（不抛错，热重载因此干净）。而直接对容器调 `register(slot, value)` 用的是保留 id `'default'`，第二次会抛 `[themeRegistry] theme slot "xxx" already registered`。两套语义都在源码里，别混着猜。
4. **单格槽换的只是"谁画"，不改数据**。比如换掉 `nodeShell` 后，节点卡片的端口、拖拽、选中环全在新组件身上 —— 默认皮把这些行为都写在 `BaseNode.vue` 里，你的壳得自己实现（或直接复用/包一层默认壳）。这也是为什么"给某类型单独换壳"要用 `nodeShell:<type>`：只接管那一种，别的仍走默认。
5. **`value` 是 opaque 句柄，容器不校验**。往槽里放一个普通对象（不是 Vue 组件）不会在注册时报错，直到宿主渲染时才炸。同理，`edgeDefaultType` 这一格放的是**字符串**（默认 `'custom'`），放成组件对象会让连线类型对不上 —— 它是"值槽"，不是"组件槽"。

