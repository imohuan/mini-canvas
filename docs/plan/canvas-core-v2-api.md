# canvas-core-v2 内核 API —— 反推结果（由五路审计倒推 · 直接给插件作者看）

日期：2026-09-04 · 状态：**API 契约 v0（待评审）**
这份不是"搬运/删除清单"，而是**从 v1 每个插件实际怎么用 ctx、缺什么、重复什么，倒推出来的 v2 内核 API**。评审对象就是下面这些签名。

> 反推依据：五路审计（audit-kernel/storage/tools/image-video/simple-nodes）——每个 v1 插件需要的 ctx 能力、v1 表达同一能力用了多少种坏姿势，全摊在审计里。API 就是从"这些坏姿势的统一最优解"反推的。

---

## 〇、反推逻辑（先懂为什么是这个样子）

| v1 的坏姿势 | 反推出的 API 设计 |
|---|---|
| 插件清理靠手写 uninstall + 逐个 off，必漏 | `setup(ctx)` 一段式，任何注册都自动回收（scope） |
| 插件互调靠 `getPluginAPI` + 字符串事件，无类型 | `ctx.get<Service>` 服务注入 |
| 事件全字符串 + 往 window 抛 + 重复 emit | 类型化 `ctx.on/emit`，单源、不碰 DOM |
| context 是手拼的 32 字段面条工厂 | 每个插件拿一个自洽的 `ctx`，能力分层 |
| config/theme/shortcut/canvas 挤一个键、卸载才存 | `ctx.save.set(key,value,type)` 四类分桶 + 改即入队 |
| 选中/删除/鼠标坐标/建节点各自抄 3 份 | 内核服务：`ctx.selection/commands/mouse/nodes` |
| selfRender 两路径能力不平等 | 节点一律 `content` 组件 + slot 声明 |

---

## 一、插件作者视角的 ctx（核心 API 契约）

一个 v2 插件长这样：
```ts
export const textPlugin = {
  name: 'text',
  deps: [],                              // 真调 ctx.get 的才算；没有就空
  setup(ctx) {                           // 一段式，无 install/uninstall
    // 全部经 ctx 注册，卸载自动清
  },
}
```

`setup(ctx)` 拿到的 ctx（类型为 `CanvasCtx`）能力分层如下：

```ts
// ============ 1. 生命周期（内核管，作者几乎不用碰） ============
interface PluginScope {
  plugin(mod, config?): this              // 嵌套插件（子插件归属本插件 scope）
  readonly scope: Scope                   // 本插件作用域令牌（一般不经手）

  // ============ 2. 服务注入（插件互调） ============
  inject<Service>(name: string, impl: Service): () => void
  get<Service>(name: string): Service      // 取别人 export 的；缺就抛（不静默降级）
  // 内置服务由内核 pre-inject：ctx.get('history'/'clipboard'/'group'/'selection'/'mouse'/'commands'/'nodes'/'save')

  // ============ 3. 事件（类型化，单源，自动回收） ============
  on<K extends keyof CanvasEventMap>(name: K, h: (p: CanvasEventMap[K]) => void): Disposable
  once<K extends keyof CanvasEventMap>(...)
  emit<K extends keyof CanvasEventMap>(name: K, payload: CanvasEventMap[K]): void
  // 事件白名单：dev 下 emit 未声明名会 warn（治 v1 漏转发静默失效）

  // ============ 4. 副作用（统一回收，插件永不写 uninstall） ============
  effect(fn: () => (() => void) | void): Disposable
  //    → 包 timer/setInterval/watch/DOM 监听/任何要清理的东西
  //    =  autoCleanup(addEventListener 返回 remove / setTimeout 返回 clearTimeout / watch 返回 stop)

  // ============ 5. 统一保存（四类分桶 key-value） ============
  save: SaveService

  // ============ 6. 核心服务（见第三节，各有接口） ============
  selection: SelectionService       // 选中态引擎（不再是各插件抄）
  commands: CommandService          // 命令中心 + 快捷键
  nodes: NodeService                // 建/删/查节点（createNodeAt 等，不再各抄 3 份）
  mouse: { flow: Ref<Point>; screen: Ref<Point> }  // 统一鼠标坐标（不再各抄 3 份）
  config: ConfigAccessor            // 声明式配置：key+默认值+面板 schema 一份驱动三处

  // ============ 7. UI 插槽（挂载点，不再自建 createApp） ============
  mount(slot: SlotName, comp: Component | (() => VNode)): Disposable
  //   slot ∈ 'overlay:viewport' | 'node:{type}:top-toolbar' | 'context-menu:node' | 'settings' ...
}
```

---

## 二、事件契约（CanvasEventMap 反推）

从 v1 所有插件 on/emit + Canvas.vue 转发的事件名反推，**先收敛成 schema，杜绝"事件名散落 + 漏转发"**：

```ts
interface CanvasEventMap {
  // —— VueFlow 画布事件（内核统一转发，插件不碰 VueFlow）——
  'nodesChange': NodeChange[]
  'edgesChange': EdgeChange[]
  'connect': { source: string; target: string; sourceHandle: string; targetHandle: string }
  'connectionRelease': { connection; pos }
  'nodeDragStart' | 'nodeDrag' | 'nodeDragStop': { nodes }
  'paneClick' | 'paneDoubleClick': { event; position }
  'paneContextMenu' | 'nodeContextMenu' | 'edgeContextMenu': { event; ... }
  'selection:change': { nodeIds: string[]; edgeIds: string[] }

  // —— 内核/插件语义事件（能力调走 ctx.get，这里只留"通知"）——
  'canvas:setFlag': never              // 删掉后门，改走 ctx.config
  'history:record': never              // 改走 ctx.get('history')
  'clipboard:copy': never              // 改走 ctx.get('clipboard')（治同名双 payload）
  'group:create': never                // 改走 ctx.get('group')
  'auto-save:saved': { projectId }
  'plugins:ready': { plugins: string[] }
  // 插件自定义事件：declare module './CanvasEventMap' 合并扩展
}
```
> 反推要点：v1 把"能力调用"和"事件通知"都塞进事件总线，导致同名双 payload、漏转发即失效。v2 **能力调用走 ctx.get，事件只留真通知**，事件表因此大幅收窄、每项 payload 唯一。

---

## 三、核心服务接口（从 v1 重复逻辑反推）

### 3.1 `save`（v1 有 4 套落点、卸载才存、一键一锅端 → 反推）
```ts
interface SaveService {
  // 业务方永远只看到 key/value/type，不感知物理落点
  set(key: string, value: unknown, type?: SaveType): void      // 入队（同步），改即防抖 flush
  get<T>(key: string, type?: SaveType): Promise<T | undefined>
  remove(key: string, type?: SaveType): Promise<void>
  flush(): Promise<void>                                        // 空闲 / visibility hidden / pagehide / 手动
}
type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'
// key 规则：project:{pid}.theme | project:{pid}.keymap | project:{pid}.graph | app.language
```
- v1 要删的双写/卸载存/beforeunload 直写，全部收进这里，作者不再能写坏。
- **adapter**：localStorage / IndexedDB / FileSystem / Backend 各一套，同一 type 任一时刻只激活一个（不双写）。`assetId` 资源走 `save.assets`（吸收 AssetStore 接口原样）。

### 3.2 `commands` + 快捷键（v1 有 3 条删除路径、命令与快捷键分离 → 反推）
```ts
interface CommandService {
  register(cmd: { id: string; title?: string; run(ctx): void | Promise<void>; keys?: string[]; when?: (ctx) => boolean }): Disposable
  execute(id: string, ...args): void        // 菜单/工具栏/快捷键都走它
  // keys 自动绑快捷键（统一入口，取代 ShortcutManager 单独注册），卸载自动解绑
}
// 内核 pre-register：'command:delete'（删选中+记历史统一处理，吸收三条删除路径）
```
> 反推要点：快捷键 = 命令上的一个可选 `keys` 字段，不再有独立的 ShortcutManager 注册通道与命令各走一套。

### 3.3 `history`（v1 靠各插件手写 history:record、谁记得谁才有撤销 → 反推）
```ts
interface HistoryService {
  undo(): void; redo(): void
  withRecord<T>(fn: () => T): T            // 包一层即进历史（内核差异记录）
  canUndo(): boolean; canRedo(): boolean
}
// 内核默认"变更即历史"：命令/节点操作自动入历史，插件无需手 record
```

### 3.4 `selection` / `nodes` / `mouse`（v1 选中引擎散落、建节点抄 3 份、坐标抄 3 份 → 反推）
```ts
interface SelectionService { ids: ReadonlySet<string>; set(ids): void; clear(): void }
interface NodeService {
  createAt(type: string, pos: Point): string   // 尺寸/端口取 registry，别处不再抄
  updateData(id: string, data: Record<string, unknown>): void  // 内容组件上报改动（治 text 编辑不写回）
  getData(id): CanvasNodeData
}
// mouse 见 ctx（流动/屏幕坐标，统一响应式，删三份 lastMousePos 监听）
```

### 3.5 `config`（v1 面板默认值与 store 默认值写两处、设置不与行为自动绑定 → 反推）
```ts
interface ConfigAccessor {
  define<T>(desc: {
    key: string                      // 'view.edge-style'
    type: 'boolean'|'number'|'select'|'color'|'text'
    default: T; options?: { label; value }[]
    group?: string                    // 面板分组
    scope?: 'app' | 'project'        // 键前缀（治 canvas-state 无项目维）
  }): { ref: Ref<T> }                 // 一份声明同时驱动：store 默认值 + 面板 schema + save(config)
}
```
> 反推要点：v1 里"panel setting 注册"与"store.toRef 持久化"是松配对、默认值各写一份。`config.define` 把它们合成一份声明。

---

## 四、节点 API（从 selfRender 假概念 + 连接手写 + window 事件反推）

**核心改变（你点名的两条）**：
1. **节点 type 直接用业务类型，废弃全 `custom`**。v1 把所有节点都注册成 `type:'custom'`、再靠 `data.nodeType` 在 CustomNode 里 switch，这是"一个壳套所有"的假统一，正是你难受的点。v2 让每个业务类型**真实注册进 vue-flow 的 nodeTypes**（`type:'text'` / `type:'image'`…），data 里不再存 nodeType 业务标记。
2. **节点 id 用短数字累加**，由内核全局提供 `createNodeId()`。废弃 v1 的 `node-${nodeType}-${Date.now()}`（又长、快速创建还会撞 Date.now）。

```ts
// 节点作者只写 content 组件 + schema，永不碰 BaseNode/BaseToolbar/NodeToolbar/registry 拼接
ctx.node.register('text', {
  label: '文本', category: '基础',
  defaultSize: { w: 300, h: 200 },
  resizable: true,
  content: TextContent,               // 纯内容组件，经注入 ctx 拿 nodeId/updateData/事件
  title: { icon: '…' },               // 只声明图标，label 由内核管
  // 连接约束声明式（不再插件手写 connect 监听删边）：
  inputs: [{ port: 'target', accepts: ['image'], limit: 'single' }],
  outputs: [{ port: 'source' }],
  onExcessInput: 'drop-oldest-with-source-cleanup',
})
```
- 内核把每个注册的 node type 映射成 vue-flow `nodeTypes['text']=…`，`createAt(type,pos)` 产出的节点 `type` = 业务 type，不是 'custom'。
- **`node:{type}:{segment}` slot**：content / title / top-toolbar / bottom-toolbar / overlay:{mode}，第三方可注入/替换已有节点任一段（治"BaseNode 插槽只对内部开放"）。
- toolbar 走 `toolbar:{context}` provider，不再用 source='multi-select'/nodeTypes 猜。
- 内容组件拿 nodeId/zoom/LOD 靠注入 ctx（治越级读全局 store）。

### 全局 id 生成器（新加入，回应"节点 id 太长"）
```ts
// 内核提供，全局单调累加、每画布自增，进程/会话内唯一即可（不做跨刷新持久 id）
function createNodeId(type?: string): string   // '1' | '2' | '12'；要带语义可 'text-1'
// 内部用画布级自增计数器（ctx 内持有，随画布 start/stop 重置），v1 的 Date.now 撞号彻底消失
```
> 注：id 只需画布内唯一。持久化画布图后刷新重建，靠存储顺序分配即可，无需把"长随机串"存进 data。

---

## 五、Scope 回收（支撑以上一切免清理的机制）

```ts
class Scope {
  onDispose(fn: () => void): () => void
  effect(fn: () => (() => void) | void): Disposable  // 包 timer/watch/DOM
  dispose(): void   // LIFO 逆序，先子后己；异常各自 try/catch 不中断
}
```
每个 `ctx.on / ctx.inject / ctx.register / ctx.mount / ctx.effect` 的返回值都会自动登记进当前插件 scope；`ctx.stop()` 或插件卸载 → `scope.dispose()` 一次清光。**插件零 uninstall 代码。**

---

## 六、已定稿的决策（用户拍板 2026-09-04）

1. ✅ **`ctx.get` 缺服务 → 抛错**（不许静默降级/探存在切换行为）。
2. ✅ **声明式连接约束** `inputs:[{port,accepts,limit}]` 采纳。
3. ✅ **`config.define` 一份声明驱动**面板 + store + save，采纳。
4. ✅ **保存入口** `ctx.save.set(key, value, type)` + type 四类，采纳。

## 七、新增确认点（用户点名，已并入正文）

1. ✅ **节点 type 直接用业务类型，废弃全 `custom`**（见 §四核心改变）。
2. ✅ **节点 id 短数字累加 + 全局 `createNodeId()`**（见 §四全局 id 生成器）。
3. ✅ **v1 的连接"先判断"严格逻辑要保留吸收进 v2**：
   - 用户评价 v1"有些逻辑不好，但连接判断逻辑非常严格、是好的"。
   - 指的是 `composables/useCanvasConnection.ts`（活 composable，连接核心）里的拖线实时校验/吸附/环检测/重复边判断，以及 `custom-handle/ConnectionValidator.ts` 的 `normalizeConnection`/`isValidCanvasConnection`。
   - v2 把这套严格校验**原样吸收**为连接内核服务，配合 §四的声明式 `inputs/accepts/limit`（校验在声明之上做，不推翻既有严格规则）。
   - 顺带：`custom-handle` 插件本身名不副实（只注入一段 handle 阈值配置），v2 并入连接内核配置，不单独成插件——但**它保护的连接校验逻辑必须保留**。

---
说人话：四个 API 点你全批了，又点了三件事——节点类型别再全用 custom、节点 id 改短数字累加、还有 v1 那套严格的连接判断要留着别改坏。全记进 API 文档定稿了，下一步就能照它开写内核。
