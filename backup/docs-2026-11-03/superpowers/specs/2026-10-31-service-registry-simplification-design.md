# 服务与注册场收敛 —— 设计文档

日期：2026-10-31 · 状态：待执行 · 类型：重构设计
依据：本轮三份只读调查（服务清点、场清点、未提交改动清点），行号均为 2026-10-31 工作区事实。
配套计划：`docs/superpowers/plans/2026-10-31-service-registry-simplification.md`

## 一、要解决的问题

不是“服务太多”这么简单。调查发现三类真实病灶：

1. **同一份数据写两处**：`theme`、`slot`、`setting` 三个场在生产代码里**没有任何读取方**，但每次注册都要额外写一遍；`slot` 场还会丢掉 `meta`，`setting` 场的 `current` 会在 `set` 之后过期。
2. **服务名记账错**：`node/creator` 场零读者，真正干活的是 `nodeFactory` 服务；`mini-map`、`shortcut-manager`、`auto-save`、`history-facade` 这些“服务”其实只是插件私有状态或设置项，占着名字让别人误以为是扩展点。
3. **同一件事有 9 份实现**：聚焦/取景散在 auto-layout、底栏、搜索、样式库、Agent、小地图、左树、编辑态、分镜拖拽里，参数各不相同，改一处不会同步到别处。

用户的原话是“把复杂的事情简单化”。所以目标不是把名字换一遍，而是：**每份数据只有一个真相，每个动作只有一个入口。**

## 二、现状事实（调查结论）

### 2.1 服务

当前按名可取的基础服务 14 个（另有 1 个条件服务）：

| 层 | 服务 | 真相/问题 |
|---|---|---|
| kernel | `tools` | 真实服务，保留 |
| canvas-data | `doc`、`selection`、`save`、`resources` | 真实服务，保留 |
| canvas-data | `command`、`nodeRegistry`、`themeRegistry`、`nodeFactory` | 本质是表；`command`/`nodeFactory` 已有真实读者，`nodeRegistry`/`themeRegistry` 是渲染层容器 |
| canvas-data | `settingsPersist`（条件） | 只是 `save` 的一个用法；`persistSettings=false` 时缺席 |
| canvas-render | `nodeLayout`、`viewport` | 两套都在描述“节点在哪、视野在哪”，9 份聚焦实现各取一半 |
| canvas-render | `pluginManager`、`tip` | 前者是宿主句柄，后者是渲染反馈 |
| 插件 | `nodeBar`、`nodeTask`、`nodeToolbar`、`group`、`image`、`video`、`text`、`clipboard`、`multi-select`、`file-drop`、`cloud-save`、`cloud-client`、`agent`、`mini-map`、`shortcut-manager`、`shortcut-remap`、`auto-save`、`history-facade`、`gen-history`、`panorama3d`、`imageCompare`、`uiNode`、`audio` | 其中 6 个只被自己或测试使用 |

### 2.2 注册场

生产代码共 17 个真实 kind（`node/mode` 只存在于文档，仓库里没有）：

| 场 | 生产读方 | 判定 |
|---|---|---|
| `command` | 命令服务/快捷键 | 保留 |
| `node/shell` | CanvasHost 装配 + 订阅 | 保留（无生产写方，但有真实读方） |
| `node/region` | BaseNode 区域渲染 | 保留 |
| `node/bar` | 底栏 / nodeBar 服务 | 保留 |
| `selection/region` | SelectionFrame | 保留 |
| `ui` | `useUiComponent().top()` | 保留 |
| `capability` | `createCapabilityCache` | 保留 |
| `tool` | 自省（生产无写方） | 保留，补生产入口 |
| `clipboard/copy`、`clipboard/paste` | CanvasHost 原生事件 | 保留 |
| `media/creator` | media 能力 | 保留 |
| `node/type` | **0** | 删除写入 |
| `node/creator` | **0** | 删除写入（`nodeFactory` 是真相） |
| `setting` | **0** | 删除写入（`SettingsStore` 是真相） |
| `theme` | **0** | 删除写入（`ThemeRegistry` 是真相） |
| `slot` | **0** | 删除写入（`SlotRegistry` 是真相，且场丢 `meta`） |
| `node/bar-applier` | 1（nodeBar 服务） | 合并进 `node/bar` |

### 2.3 聚焦实现（9 份）

| 实现 | 会改选中 | 会改缩放 | 可视区来源 | 关键参数 |
|---|---|---|---|---|
| `auto-layout:focus-selected` | 否 | 是 | `getRootEl()` | `focusHeightRatio=0.5`、zoom 0.1–4 |
| `auto-layout:focus-node` | 否 | 是 | 同上 | 同上 |
| `viewport.fitView(padding)` | 否 | 是（整图） | 后端 | padding 0.1/0.15/0.45 三种调用 |
| `fitEditingNodeIntoView` | 否 | 是 | `getPaneEl()` | `margin=0.6`、已可见不动 |
| `BaseNode.focusNodeIfNeeded` | 否 | 否（保 zoom） | 可见矩形 | 标题额外 32px |
| `ui.locateNode` | **是** | 否（保 zoom） | 矩形/退路 fitView | 退路 padding 0.45 |
| `node-find` / `Agent` / `style-library` | 前者否，后两者**是** | 否 | 矩形中心 | 保当前 zoom |
| `ReferenceSelectOverlay` | 否 | 是（<0.6 抬到 1） | 矩形/DOM 反算 | 下限 1 |
| `ensureNodeVisible`（分镜拖拽） | 否 | 否 | 可视矩形 | margin 24px，已可见不动 |

三条差异必须由新 API 表达：**是否选中**、**是否改缩放**、**可视区与是否含控制栏**。

## 三、目标形态

### 3.1 基础服务从 14 个降到 7 个

| 服务 | 归谁 | 说明 |
|---|---|---|
| `tools` | kernel | 不动 |
| `doc` | canvas-data | 不动 |
| `selection` | canvas-data | 不动 |
| `save` | canvas-data | 吸收 `settingsPersist` 与 `auto-save` 的定时器/脏位 |
| `resources` | canvas-data | 不动 |
| `view` | canvas-render | **新建**：合并 `nodeLayout` + `viewport`，新增 `fitTo()` |
| `canvas` | canvas-render | **新建**：动作门面（建/选/聚焦/进模式/打组/提示/跑底栏动作） |

`command`、`nodeRegistry`、`themeRegistry`、`nodeFactory` 不再作为独立服务名对外：

- `command` → 场 `command`（执行仍由 CommandService 承担，但插件侧只认场 + `canvas` 动作）
- `nodeFactory` → 场与 `canvas.creatableTypes()` / `canvas.createNode()`
- `nodeRegistry` / `themeRegistry` → 渲染层内部容器（由宿主持有，插件用 `node/region` / `theme`？不：主题用 `ctx.theme` 糖写 `theme` 服务，插件不需要按名取容器）

> 兼容期保留这些名字为“已弃用别名”，指向同一实例；计划里逐个迁移调用方，最后一步才删名字。

### 3.2 注册场从 17 个降到 11 个

保留：`command`、`node/shell`、`node/region`、`node/bar`、`selection/region`、`ui`、`capability`、`tool`、`clipboard/copy`、`clipboard/paste`、`media/creator`。

删除：`node/type`、`node/creator`、`setting`、`theme`、`slot`。
合并：`node/bar-applier` → `node/bar` 的 `appliers/<kind>` 键。

### 3.3 新 API 形状

```ts
// 服务名 view（canvas-render 注入）
interface ViewService {
  // —— 几何（原 nodeLayout 读口，语义逐条保留）
  nodeSize(id: string): { w: number; h: number }
  absolutePosition(id: string): { x: number; y: number }
  getNodeRect(id: string): LayoutRect | null
  getAllRects(): LayoutRect[]
  childrenOf(parentId: string): LayoutRect[]

  // —— 视口（原 viewport，语义逐条保留）
  getViewport(): ViewportState
  setViewport(v: ViewportState): void          // 必须即时
  animateViewport(v: ViewportState, ms?: number): void
  setCenter(x: number, y: number, zoom?: number): void
  fitView(padding?: number): void
  zoomIn(): void; zoomOut(): void; zoomTo(level: number): void
  screenToFlow(x: number, y: number): FlowPoint
  flowToScreen(x: number, y: number): FlowPoint
  getRootEl(): HTMLElement | null
  getPaneEl(): HTMLElement | null
  getRendererEl(): HTMLElement | null
  queryNodeEl(id: string): HTMLElement | null

  // —— 唯一取景算法（新增）
  fitTo(target: FocusTarget, opts?: FitToOptions): boolean
}

type FocusTarget = string[] | 'selection' | 'all'

interface FitToOptions {
  /** 留白比例（0..0.49，与 VueFlow fitView 同义）；不写 heightRatio 时用它适配整块内容 */
  padding?: number
  /** 目标内容高度占视口高度的比例（auto-layout / 底栏用 0.5）；写了它就不看 padding */
  heightRatio?: number
  minZoom?: number      // 缺省 0.1
  maxZoom?: number      // 缺省 4
  /** true = 保持当前 zoom，只平移（locateNode / 搜索 / Agent 的语义） */
  keepZoom?: boolean
  /** 指定固定 zoom（ReferenceSelectOverlay 的“抬到 1”用它） */
  zoom?: number
  /** 是否顺手选中目标；缺省 false（只有 locateNode/style-library 传 true） */
  select?: boolean
  /** 是否只在该节点不可见时移动（ensureVisible / BaseNode 语义）；缺省 false */
  onlyIfOutOfView?: boolean
  /** 不可见判定的额外边距（像素）；BaseNode 用 32，分镜拖拽用 24 */
  margin?: number
  /** 要不要把上下状态栏算进包围盒：'none' | 'bottom' | 'both'；缺省 'none' */
  includeBars?: 'none' | 'bottom' | 'both'
  /** 是否播放过渡；缺省 true。逐帧场景传 false */
  animate?: boolean
  /** 动画时长；缺省 320 */
  durationMs?: number
}
```

```ts
// 服务名 canvas（canvas-render 注入）
interface CanvasService {
  createNode(type: string, at: { x: number; y: number }, opts?: { data?: Record<string, unknown>; sourceNodeId?: string; gap?: number }): string | undefined
  creatableTypes(): string[]
  select(ids: string[], mode?: 'replace' | 'add' | 'toggle'): void
  focus(target: FocusTarget, opts?: FitToOptions): boolean
  enterMode(nodeId: string, modeId: string): boolean
  exitMode(nodeId?: string): void
  activeMode(nodeId: string): string | undefined
  group(nodeIds: string[]): string | null
  ungroup(groupId: string): void
  notify(message: string, opts?: NotifyOptions): () => void
  runBarAction(nodeId: string, actionId: string, input?: unknown): Promise<unknown>
  cancelBarAction(nodeId: string): void
}

interface NotifyOptions {
  source?: string        // 谁能撤回自己的提示
  priority?: number
  once?: boolean
  durationMs?: number    // 0 = 常驻
  followPointer?: boolean // 缺省 true（保留 tip 的跟随鼠标语义）
}
```

### 3.4 兼容别名矩阵（逐步删除，不是永久保留）

| 老名字 | 新名字 | 兼容方式 | 删除时机 |
|---|---|---|---|
| `nodeLayout`、`viewport` | `view` | 两个名字指向同一个 `ViewService` 实例 | 所有调用方迁完 + 一轮发布后 |
| `tip` | `canvas.notify` | `tip.show/hide` 转发 notify，`followPointer: true` | 迁移完即删 |
| `nodeTask` | `canvas.runBarAction` / `cancelBarAction` | 别名对象，保留 `restoreAll` 临时挂载 | 迁移完即删 |
| `settingsPersist` | `save` | `save.settings` 子对象（`restore/persistNow/resetKey`） | 迁移完即删 |
| `auto-save` | `save` | `save.autoSave` 子对象 | 迁移完即删 |
| `mini-map` | 设置项 `miniMapVisible` | 服务只留 `visible` getter 转发设置 | 迁移完即删 |
| `shortcut-manager` / `shortcut-remap` | 插件内部状态 + 设置项 | 不再对外上架 | 直接删 |
| `history-facade` | `doc` | 无兼容必要（生产零调用） | 直接删 |
| `gen-history` | `cloud-client:history` | 改名，语义（AbortSignal/订阅）不变 | 一次发布后删旧名 |
| `pluginManager` | `host.manager` | 别名指向同一个 manager；新代码从 handle 拿 | 迁移完即删 |
| `nodeFactory` | `canvas.creatableTypes/createNode` | 别名指向内部工厂 | 迁移完即删 |
| `command` 服务 | 场 `command` + `canvas` | 服务保留执行入口，插件侧不再新增直接依赖 | 长期保留执行入口 |

## 四、决策记录

**D1 删除零读取的场，而不是“留给自省”。**
`node/type`、`node/creator`、`setting`、`theme`、`slot` 在生产代码里没有读方。保留它们只会让下一个人以为“写进去就会生效”。自省改为从真实容器取（`ThemeRegistry` / `SlotRegistry` / `SettingsStore` / `nodeFactory`）。
代价：`surface().registryEntries` 少 5 个 kind，e2e 断言要改。

**D2 `node/shell` 保留。**
它有真实读方（`assembleTheme` 四级解析 + 场订阅重装配），虽然目前只有测试在写。删掉会让“换壳”能力消失。

**D3 `node/bar-applier` 合并成 `node/bar` 的键。**
两者同源同生命周期，拆两张表后“一个 kind 只能一个写入器”的冲突检查只能落在一张表上。合并后键为 `actions/<id>` 与 `appliers/<kind>`。

**D4 `nodeToolbar` 从主题插件搬到 canvas-render。**
模式注册与会话现在住在 `plugin-theme-default`，卸载主题就丢模式——这是真实缺陷。搬到渲染层后主题只负责画。服务名保持 `nodeToolbar`，不新建 `node/mode` 场（场无法表达“同一时刻只有一个节点在模式里”的会话状态）。

**D5 聚焦只保留一个算法。**
`view.fitTo` 用 `keepZoom / zoom / heightRatio / onlyIfOutOfView / select / includeBars` 覆盖现有 9 份实现的全部差异。首屏 `fitViewFirstRun` 的重试逻辑**不进** `fitTo`（它是对“尺寸还没量到”的补偿，属于宿主启动流程）。

**D6 `canvas` 是动作门面，不存数据。**
它只做参数校验 + 转发；数据仍在 `doc` / `selection` / `view` / 场里。这样“建节点”只有一条路径，撤销与落盘不会分叉。

**D7 通知保留跟随鼠标。**
`tip` 不是 toast：它跟着鼠标、空串即隐藏、多个持有者不能互相盖掉。`canvas.notify({ followPointer: true })` 必须保留这三点，否则拖线提示会变成屏幕角落的弹窗。

**D8 别名是迁移工具，不是终态。**
每个别名在计划里都有“删除这一步”，并有测试断言“旧名已不存在”。

## 五、必须保留的行为（迁移验收清单）

来自三份调查，逐条写进计划的测试里：

1. `nodeSize` 优先级：实测 > `node.size` > `type.defaultSize`；零尺寸回落 `{0,0}`。
2. `absolutePosition` 沿父链累加并带环保护；`getAllRects` 含子节点、顺序同 store。
3. 节点被可见剔除（DOM 消失但仍在 store）时**保留**实测尺寸；真删除才清。
4. 观测停止时 `reset()` 清空实测值。
5. viewport 未 attach 时读 `{0,0,1}`、控制 no-op、不抛。
6. `setViewport` 即时；`animateViewport` 才过渡（默认 320ms）。
7. `fitView` 默认 padding 0.1；首屏 0.15、`locateNode` 退路 0.45 不被统一改写。
8. `fitTo` 支持指定节点集合 + padding + 缩放夹取。
9. DOM 锚点实例级，不跨宿主。
10. `settingsPersist` 条件缺席语义（`persistSettings=false` 或缺 `settings`）。
11. 配置恢复顺序：声明 → define → `await restore()` → 主题落值；restore 后才订阅。
12. 合并 auto-save 后保留：1000ms 周期、脏位、失败恢复脏位、停用不清脏位、卸载停表。
13. 通知：全局唯一、跟随鼠标、空串隐藏、可撤回、多持有者不互盖。
14. 底栏动作：按 nodeId 的 AbortController 覆盖/清理、取消、`restoreAll`、节点删除时静默跳过。
15. mini-map 双向同步（设置 ↔ 显隐）；shortcut 默认键快照、冲突预检、导入跳过、`shortcut` 域持久化。
16. `locateNode` 先选中再聚焦、优先保 zoom；`fitEditingNodeIntoView` 已可见不动 + 编辑余量 + pane 尺寸。
17. `pluginManager`：核心插件卸/换明确报错、uninstall 失败不丢 config、manifest 跳过 disabled、同 id 覆盖、`hiddenPlugins` 只影响 list/diagnose。

## 六、风险与回退

| 风险 | 影响 | 回退 |
|---|---|---|
| 删场后自省/诊断缺数据 | 低 | 每个删场的提交独立，`git revert` 即恢复 |
| `view` 合并漏掉写口（`setMeasuredSize`） | 高（量测失效） | `view` 同时暴露内部写口，`useNodeMeasure` 只改取用方式 |
| `fitTo` 统一后语义漂移 | 中 | 先做“旧实现 → fitTo”的对照测试，再删旧代码 |
| `nodeToolbar` 搬家导致模式注册时序变化 | 高 | 保留服务名，先搬家后改调用方；主题只删注册代码 |
| 别名永久化 | 中 | 计划里每个别名都有删除任务与“旧名不存在”测试 |

## 七、不做的事

- 不碰 `backup/canvas-core` 与根目录 `src/`。
- 不改 `BaseNode.vue` 的十个区域渲染结构（只改它取 `view`/`nodeToolbar` 的方式）。
- 不重写 `plugin-image-grid-split` 的发布事务编排（用户刚改的代码，只做服务取用替换）。
- 不引入第三方依赖。
- 不把 `tool` 场与 `ctx.tools` 合并（两套东西：模型可调用工具 vs 生成工具服务）。

## 八、验收

1. 基础服务名 = 7 个（`tools/doc/selection/save/resources/view/canvas`），旧名在最后一次任务后不可取。
2. 生产注册场 = 11 个，`surface()` 能列出；零读取的 kind 不再出现。
3. 聚焦调用点只剩 `view.fitTo`（首屏重试除外），行为对照表逐条通过。
4. `pnpm -C packages/kernel test`、`canvas-data`、`canvas-render`、`ui`、受影响插件包全绿；`canvas-render`/`ui` typecheck 通过。
5. Chrome 实测：建/连/删/撤销/刷新恢复、底栏生成、模式进出、通知跟随鼠标、宫格发布、分镜拖拽、插件装卸。
6. 控制台零 error。
