# 画布核心分层与注册场 —— 设计文档

日期：2026-09-17 · 状态：**待评审（未开始实现）** · 类型：架构设计 · 版本：**v2（已过一轮独立审核）**
依据：`docs/tmp/architecture-layer-audit/report.md`（只读调查）+ 与作者的多轮澄清
参考：`deepseek-harness/docs/cordis-tutorial/03-services.zh.md`（服务）、`07-into-the-harness.zh.md`（工具）

> **v2 修订说明**：v1 经过两个独立子代理审核（设计审核 + 事实核验），修掉了一批"照着做会踩坑"的问题：栈序自相矛盾、`Registry` 接口缺成员导致"测试一条不删"不可能达成、漏掉第五个老段位词 `overlay`、两套 tools 归属打架、`ctx.state` 没有创建步骤、`attach` 从未定义、`pluginManager` 在核心插件上会抛重名错、改名会打破 cordis parity 测试、步骤 5 无兼容垫片与回退方案。被改掉的原判断在正文相应位置以"**勘误**"标出。

## 待审批清单（看这里就够）

下列 9 条是**我已自决、等你点头**的。每条在 §十一 决策记录里有完整定义；批准即照它实现，不同意就说哪条、怎么改。

| # | 事项 | 我的定案 | 影响面 |
|---|---|---|---|
| 1 | 核心插件不可热卸怎么表达 | 插件加 `core: true` 标识（类形态 `static core = true`）；`uninstallPlugin` 返回 `false` 拒卸；`stop()` 不拦；**另加 `ctx.canUninstall()` 供先问再动** | kernel（3 处改动）、`pluginManager`（4 处调用点）、宿主 UI |
| 2 | 多层叠加时谁在外 | **维持现状**：`order` 小者在外、负责覆盖；`list()` 升序从外到里 | 全部 `order` 用法，**最易埋雷** |
| 3 | 老五个段位词怎么迁 | 一次性迁到区域词 + 迁移期垫片（`overlay` → `over:inset`）；**步骤 9 删垫片** | `BaseNode.vue` 与所有节点插件 |
| 4 | 组件目录边界 | 只收"想被换皮的"（按钮/下拉/滑块），内部小组件照旧 import | `ui` 场 |
| 5 | 两套 tools 命名 | 画布生成工具保留 `ctx.tools`；模型可调用工具走 `ctx.registryOf('tool')` | kernel、两个工具插件 |
| 6 | 注册场入口命名 | 叫 **`ctx.registryOf(kind)`**；诊断 `ctx.registry` 原样不动 | 零冲突，纯新增 |
| 8 | 不改行为那几步的验收 | 既有测试**一条不删**（有明确例外清单） | 步骤 1/2/3 |
| 9 | 能力包的所有权与缺失行为 | 任何插件可注册；每节点一份实例、由消费方回收；dev 缺项抛错、prod 返回 `undefined` | `capability` 场、所有用 `needs` 的组件 |
| 10 | 删 `menu` 的准确范围 | 删 `menuService.ts`；`buildMenuItems` **复活**为生产代码；类型保留 | `canvas-data`、`plugin-context-menu` |

**已定（来自你的话或既有约束，无需审批）**：v1 老包 `packages/canvas-core` 不碰（`AGENTS.md` 红线）；`inject` 是硬依赖、`ctx.get` 才是可选探测（你此前已指正）；核心插件用标识声明（你的原话）。

---

## 〇、这份文档解决什么

作者原话：

> "当前的问题就是没有一个很好的底子，功能全是堆砌上去，最开始是想分工明确，可越是做到后面越是混乱，因为很多功能都需要其他的地方支持，这就又需要我提供新的 api 功能。"

病根不是"某个服务放错位置"，而是两件事同时发生：

1. **位置是数出来的，不是开放出来的** —— 给节点加东西只有 5 个写死的位置（内容/标题/上栏/下栏/覆盖层），加进度条必须改 `BaseNode.vue`。
2. **新功能只能靠加服务** —— 手上没有通用"放东西"的机制，所以每要放一类新东西，只能再 `ctx.inject('xxx', 一张表)`。菜单就是这么来的。

本文给出终态设计：**三根轴、七个原语、七条规则**，以及一张"每个服务各自归哪"的对照表。

**目标：以后加新功能（节点按钮、进度条、工具栏、组件目录、主题换皮）不需要改核心，也不需要新增服务。**

---

## 一、终态：三根轴

现在代码里有七八种叫法（插件 / 服务 / 能力 / 能力段 / 注册表 / 注册场 / 容器），人记不住，所以乱。收敛成三个词（旧词对照见 §十二 术语表末段）：

| 轴 | 干什么 | 一句话判据 | 今天状态 |
|---|---|---|---|
| **装载轴** | 装插件、卸插件、管依赖 | 谁在跑 | ✅ 完整，不动 |
| **服务轴** | 按【名字】拿一个【对象】 | 谁会做事 | ✅ 完整，**减数量** |
| **注册轴** | 按【种类】放/取一串【条目】 | 谁放了什么 | ⚠️ 有，但**七套各写一遍** |

三根轴里只有第三根是乱的。前两根都干净——`kernel` 的装载与依赖编排、`Service` 子类 + `inject` 的服务模型，已经和 cordis 教程第 3 章 1:1 对齐，且真实在用（`TextService`/`ImageService`/`VideoService`/`Panorama3DService`/`ImageCompareService`/`ClipboardServiceImpl`/`GroupService`/`MultiSelectServiceImpl`/`FileDropServiceImpl` 九个 Service 子类）。

### 1.1 三个词的界线（最容易混的地方）

> **服务是"一个能手"，注册场是"一张表"。**

| 东西 | 是服务还是场 | 判据 |
|---|---|---|
| `ctx.tools` | 服务 | 换实现（本地/云端/假货）要改行为 |
| `ctx.doc` | 服务 | 同一份数据，将来换 CRDT/协同 |
| `ctx.registryOf('ui')` | 场 | 里面只是"一堆按名字取的组件" |
| `ctx.registryOf('command')` | 场 | 里面只是"一堆条目" |
| `ctx.nodes` / `ctx.theme` | 场的糖 | 只是 `ctx.registryOf(...)` 的短写法 |

**"一张表"不该是服务；"一个会换实现的能力"才该是服务。** 这条界线决定下一节的服务数量。

**注册场不占服务名**——它和 `ctx.on` / `ctx.effect` 一样，是 `ctx` 自带的方法。糖也不占，糖只是转发。

---

## 二、终态：七个原语

插件作者要学的东西压到七个。前六个由 `kernel` 的原语给（`ctx` 上的六个方法），第七个是区域词表（节点位置，由渲染层的 `BaseNode` 消费）。

```ts
// ============================================================
// kernel —— 只认这 7 样。不认识节点、不认识画布、不认识界面
// ============================================================
interface Context {
  // ① 装载：装/卸/依赖/配置
  plugin(mod, config?): this
  installPlugin(mod, config?): string          // 运行中热装
  uninstallPlugin(name): boolean

  // ② 服务：按【名字】拿一个【对象】
  provide(name, impl): void                    // Service 子类 super(ctx,name) 内部调它
  get<T>(name): T                              // inject 声明硬依赖；get 是可选探测
  tryGet<T>(name): T | undefined

  // ③ 事件：通知，不关心谁在听
  on(name, fn): Disposable
  once(name, fn): Disposable
  emit(name, ...args): void

  // ④ 作用域：我注册的东西，卸我时自动清
  effect(fn: () => Disposable): Disposable

  // ⑤ 注册场：按【种类】放/取一串【条目】   ← 今天缺的就是这个
  registryOf<T>(kind: string): Registry<T>

  // ⑥ 状态：插件自己的数据，不占服务名
  state<T>(initial: T): State<T>
}
```

第七个不是 `ctx` 上的方法，是**区域词表**（节点上能放东西的十个位置，见 §五）。

### 2.1 注册场的形状

**接口必须包含现有成员**（`SlotRegistry` 今天已有，被既有测试与插件依赖，不能只留六个方法）：

> **为什么 `list` 是"从外到里"**：见决策 2——`order` **小 = 优先级高 = 覆盖者**；`list` 按 `order` 升序，
> 所以第一条就是覆盖者（最外层）。这与今天的 `SlotRegistry.list()`（升序）和 `first()`（= 覆盖者）
> **逐字一致**，所以步骤 1 是纯新增、行为不变。

```ts
interface Registry<T> {
  // —— 写 ——
  /**
   * 放一条。同 id 重复 = 替换该 id 那条（不新增）。
   * 返回 `{ id, dispose() }`：**老调用方取 `.id`（今天的 `add()` 就返回 string），新调用方可 `.dispose()`**
   * —— 两边都满足，糖才转得动（见 §8.2 的"必须保留的行为"）。
   */
  add(key: string, value: T, opts?: { id?: string; order?: number }): { id: string; dispose(): void }
  /** 移除某条；不存在返回 false */
  remove(key: string, id: string): boolean
  /** 清空某键（或前缀下全部） */
  clear(key: string): void
  clearByPrefix(prefix: string): void

  // —— 读 ——
  /** 整摞。**按 order 升序 = 从外到里**（最外层/覆盖者在最前）。这就是作者要的"列表" */
  list(key: string): Entry<T>[]
  /** 最外面那条 = "覆盖"语义 = order 最小者。空则 undefined（等价于今天的 `first()`） */
  top(key: string): Entry<T> | undefined
  /** 按 id 精确取（replace/查找/诊断用） */
  get(key: string, id: string): Entry<T> | undefined
  /** 某键是否已有条目 */
  has(key: string): boolean
  /** 某键已有条目的 id 列表（诊断/热卸用） */
  ids(key: string): string[]
  /** 已有条目的键列表（诊断/枚举用） */
  keys(): string[]

  // —— 组合与订阅 ——
  /** 包住下一层：fn 收到 inner（下面那层），返回新的 T。缺省放在最外 */
  wrap(key: string, fn: (inner: T, entry: Entry<T>) => T, opts?: { id?: string; order?: number }): Disposable
  /** 合成好的那一个（从里到外逐层套完） */
  resolve(key: string): T | undefined
  /** 变了通知我（渲染侧订阅重绘） */
  subscribe(fn: () => void): Disposable
}

interface Entry<T> {
  id: string          // 条目 id（同 id 替换）
  value: T            // 值（组件 / 命令 / 描述）
  order: number       // 排序（小 = 在外/覆盖者）
  source: string      // 谁放的 ←── "分不清谁是谁"的解药
}
```

### 2.2 键是路径，不是字符串

```
node/shell/image              精确：某一类节点的壳
node/shell/*                  通配：所有节点的壳
node/shell                    默认：兜底
```

查找从**最精确往最粗**走：精确 → 通配 → 默认。
`list('node/shell')` 返回整棵子树下全部注册者（含 `image` 与 `*` 两个来源）。

### 2.3 两个已有注册表天然就是场

`kernel/src/registry/slotRegistry.ts` 里的 `SlotRegistry` **已经是这条 API 的雏形**：

| 终态接口 | `SlotRegistry` 现有成员 | 差异 |
|---|---|---|
| `add(key, value, opts)` | `add(slot, req): string` | 今天只返回 id；终态返回 `{ id, dispose() }`（`.id` 与今天兼容） |
| `list(key)` | `list(slot): SlotEntry[]` | ✅ 已一致 |
| `top(key)` | `first(slot): SlotEntry \| undefined` | ✅ 只是改名 |
| `subscribe(fn)` | `subscribe(listener): () => void` | ✅ 已一致 |
| `wrap` / `resolve` | — | **需新增** |

所以第一步不是发明新东西，是**把已有的提成公开 API 并补两个方法**。

---

## 三、七条规则

规则不会过期，表会。以下七条是这套设计的全部约束。

**规则 1 · 永不覆盖，只往栈上叠。**
"覆盖"只是"我这层在最外面"。底层永远在，永远查得到。这是"主题插件替换别人插件"能成立的前提——它一覆盖，别人就没得包了。

**规则 2 · 注册场里只放"将来可能被换掉的东西"。**
算几何、格式化时间这类纯函数**直接 import**。注册进去只会变成字符串驱动：打错字跑起来才炸、丢类型提示。这是"分不清谁是谁"的另一条路。

**规则 3 · 数据走 props，能力走上下文。**
组件专属数据（按钮文案、面板宽度）写注册时的 `props`；通用能力（缩放、选中、读写节点）走 `useCapabilities()`。后者所有组件同一个形状，可测也可换。

**规则 4 · 一件东西归谁，只看它依赖什么。**
只依赖框架 → `kernel`；只依赖文档数据 → `canvas-data`；要摸 DOM / vue-flow 实例 → `canvas-render`；只服务某个具体功能 → **那个功能的插件里，不外溢**。

**规则 5 · "一张表"是场，"一个能手"是服务。**
见 §1.1。这条决定服务数量。

**规则 6 · 基础能力不可热卸，用 `core: true` 标识声明。**
见 §十一 决策 1。这是整套改造的技术核心。

**规则 7 · 默认不暴露。**
插件自己的数据用 `ctx.state`，不占服务名。真要被别人读，才升成服务或注册场条目。

---

## 四、服务归属表现状（2026-10-31 已落地）

按规则 4 + 规则 5 重算。

### 4.1 现在的 7 个基础服务

| 服务 | 归谁 | 为什么是服务（不是场） |
|---|---|---|
| `tools` | kernel | 通用：调外部能力，与画布无关。**已存在，不动** |
| `doc` | canvas-data | 节点+边+事务+撤销+落盘。**由今天的 `nodeStore`+`edgeStore`+`graph`+`history` 合并** |

> **补充申报（5c 落地后回填）**：`doc` 上还公开了 `registerType / unregisterType` 两条**节点类型表写口**。
> 它**不是**给作者的第二条注册路径 —— 作者侧正式入口始终是 `ctx.nodes.register`（一次落数据 + 展示两处）。
> 这两条只是「只落数据侧」的低层口，唯一消费者是 `registerNodeType(ctx, def)` 底层助手与能力层
> （助手自己没有实例，类型表唯一持有者就是 doc）。
| `selection` | canvas-data | 选中态（将来可能换协同版） |
| `save` | canvas-data | 存储适配器（本地/云端可插拔） |
| `resources` | canvas-data | Blob / objectURL 生命周期 |
| `view` | canvas-render | 合并节点几何与视口；要量 DOM、抓 vue-flow 实例，并提供唯一 `fitTo` |
| `canvas` | canvas-render | 动作门面：建/选/聚焦/进模式/打组/提示/跑底栏动作 |

另有一个**渲染层辅助服务** `nodeToolbar`（Spec D4）：节点上下状态栏的会话与模式注册。
它不属于基础七名，但仍是宿主必装、插件可按名取的服务；主题只负责画，卸载主题不再丢模式。

### 4.2 已从服务名单退出的那些

| 今天的 | 终态 | 处理 |
|---|---|---|
| `nodeStore` / `edgeStore` / `graph` / `history` | `doc` 一个服务 | **合并**（4 → 1） |
| `command` | 场 `ctx.registryOf('command')` | 变场 |
| `nodeFactory` | `canvas.createNode` / `canvas.creatableTypes` | 容器留在内部运行时，插件不再按名取 |
| `nodeRegistry` | 渲染层内部容器（`host.nodeRegistry` / `ctx.nodes` 糖） | 不再按名取 |
| `themeRegistry` | 渲染层内部容器（`host.themeRegistry` / `ctx.theme` 糖） | 不再按名取 |
| `settings` | 能力层内置容器（`ctx.settings` 糖） | 不占基础服务名 |
| `settingsPersist` | `save.settings` 子对象 | **收回内部**，不占服务名 |
| `nodeLayout` / `viewport` | `view` | 合并；旧名已删 |
| `pluginManager` | `host.manager` | 宿主句柄，旧名已删 |
| `tip` | `canvas.notify` | 通知队列与撤回语义不变 |
| `nodeTask` | `canvas.runBarAction` / `cancelBarAction` | 动作执行门面 |
| `menu` | 删掉 | 只服务右键菜单一个插件，是个局部函数，直接 import |

### 4.3 插件自己提供的服务（不是基础服务，但有两类要清）

该留的（真有别人跨插件用）：`text`、`image`、`video`、`panorama3d`、`imageCompare`、`clipboard`、`group`、`multi-select`、`file-drop`、`cloud-save`。

该收回去的：

实测插件提供的服务共 **16 个**：`text, image, video, panorama3d, imageCompare, clipboard, group, multi-select, file-drop, cloud-save, shortcut-manager, shortcut-remap, mini-map, auto-save, history-facade, image-meta`。

2026-10-31 已全部收口：`shortcut-manager` 也收回插件内部（面板由同包组件读取），不再占服务名。

| 分类 | 名单 | 处理 |
|---|---|---|
| **留下**（真有别人跨插件用） | `text, image, video, panorama3d, imageCompare, clipboard, group, multi-select, file-drop, cloud-save`（**10 个**） | 不动 |
| **收回插件内部** | `shortcut-remap`、`history-facade`、`mini-map`、`auto-save`（**4 个**） | 已收回插件内部/设置项，不再占服务名 |
| **删** | `image-meta`（值 = `{ v: 1 }`，纯 HMR 探针）（**1 个**） | 删 |

> 注：`shortcut-manager` 同样已收回，当前生产插件服务为 10 个；上表的 16 是重构前的实测总数。

**判据：真的有别的插件要用它吗？没有就收回去。**

### 4.4 数字对照（2026-10-31 实测）

| | 重构前 | 现在 |
|---|---|---|
| kernel 认的服务 | 1（`tools`） | 1 |
| 画布基础服务 | **14**（另有条件服务 `settingsPersist`） | **6**（`doc`/`selection`/`save`/`resources`/`view`/`canvas`） |
| 其中"其实是一张表"的 | **4 个**：`command`、`nodeFactory`、`nodeRegistry`、`themeRegistry` | 0（退出服务名，容器留在内部） |
| 插件自己的服务 | 16 | 10 留 + 5 收回 + 1 删 |
| **基础服务合计** | 1 + 14（+1 条件）= **15–16** | 1 + 6 = **7**（另有渲染层辅助 `nodeToolbar`） |

**基础服务从 14 个（外加 1 个条件服务）收敛到 7 个。** 减少的机制不是"删功能"，
是**把被误当成服务的表还原成场，把同源的两套合成一个入口**。

### 4.5 注册场种类总表（生产 11 个，2026-10-31 实测）

初稿把 `node/*` 的种类散在 §4.2、§8.2 等处各写一半，实现者要猜。集中如下（**这张表就是全部种类的权威来源**）：

| 场（kind） | 键（key） | 值（value） | 消费者 |
|---|---|---|---|
| `command` | 命令 id | `CommandDef` | 菜单/工具栏/快捷键分发（`CanvasHost`） |
| `node/shell` | 节点 type 或 `*` | 壳组件（`BaseNode` 等） | `BaseNode` 装配 |
| `node/region` | `<type>/<region>` | `{ component, props, needs?, order }` | `BaseNode` 按区域渲染 |
| `ui` | 组件名（`button`/`dropdown`/…） | 设计系统组件 | 其它插件按名取 |
| `capability` | 能力名（`node`/`zoom`/`tools`/…） | 工厂 `(nodeId) => Capability` | `useCapabilities()` |
| `tool` | 工具名 | `ToolDef`（function calling 形态） | 模型/外部调用方 |
| `node/bar` | `actions/<id>`、`appliers/<kind>` | 底栏动作 / 结果写入器 | 默认底栏、`nodeTask` 写回节点 |
| `selection/region` | 区域词 | `{ component, props, needs?, order }` | 多选框区域渲染 |
| `clipboard/copy` | `copy`、`cut` | 写剪贴板处理器 | `CanvasHost` 原生 copy/cut |
| `clipboard/paste` | `paste` | 粘贴处理器 | `CanvasHost` 原生 paste |
| `media/creator` | 媒体 kind | `MediaKindCreator` | media 能力 |

**已删除**：`node/type`、`node/creator`、`setting`、`theme`、`slot`（生产零读取，真相分别在
`doc` 的类型表、内部 `nodeFactory`、`SettingsStore`、`ThemeRegistry`、`SlotRegistry`）。`node/bar-applier`
已并进 `node/bar` 的 `appliers/<kind>` 键。

---

## 五、区域词表：节点上能放东西的十个位置

位置不该是 `content` / `title` / `top-toolbar` / `bottom-toolbar` / `overlay` 五个写死的名字，而是**十个闭合的区域词**。

**区域决定贴在哪儿（几何，主题的事），名字自由（插件的事）。**

**今天的真实位置是五个，不是四个**（`NodeSegment = 'content' | 'title' | 'top-toolbar' | 'bottom-toolbar' | 'overlay'`，`nodeRegistry.ts:30`）。五个全部映射进区域词：

| 区域词 | 贴在哪 | 今天的对应（老段名） | 用途 |
|---|---|---|---|
| `title` | 标题位（单个） | `title` | 就地改名 |
| `in` | 卡片内部（可叠多层） | `content` | 内容组件 |
| `out:top` | 卡片上边外侧一条 | `top-toolbar` | 顶部操作条 |
| `out:bottom` | 卡片下边外侧一条 | `bottom-toolbar` | 底部状态栏 / 生成面板 |
| `over:inset` | **卡片内部覆盖层**（不超出卡片） | `overlay` | 编辑浮层（图片裁剪、视频剪辑） |
| `out:left` / `out:right` | 左右外侧 | **无** | 侧挂按钮、折叠把手 |
| `on:top` / `on:bottom` | **贴在卡片边框线上** | **无** | **进度条** |
| `over:outset` | 盖住整张卡**且允许超出卡片边界** | **无** | 拖拽手柄、悬停放大 |

**关于 `over` 的一处重要澄清**（避免新造一对同义词）：今天已有两种"覆盖"，必须分清——

| 今天的东西 | 是什么 | 新区域词 |
|---|---|---|
| 节点段 `overlay` | 某个节点类型自己的**编辑浮层**（`nodeImagePlugin`/`nodeVideoPlugin` 在用） | `over:inset` |
| 画布槽 `ctx.slots.register('overlay', …)` | **画布级**浮层，与小地图/快捷键面板同类，**不是节点位置** | 不进区域词表，仍走 `registryOf('slot/overlay')` |

早期草稿里那个名叫 `over` 的单一区域词已删——它同时被当成"盖住卡片"和"已有 overlay 段"，会让实现者把两个不同的东西合成一个。现在拆成 `over:inset` / `over:outset` 两个，语义各自明确。

**十个区域词**：`title`、`in`、`out:top`、`out:bottom`、`out:left`、`out:right`、`on:top`、`on:bottom`、`over:inset`、`over:outset`。闭合：按钮、面板、进度条、遮罩、侧挂件全部落在里面。

真出现全新的物理位置（比如"卡片外面再套一圈装饰"），那是主题该加一个区域——**这一步要改 `BaseNode.vue`**，而它是 `AGENTS.md` 点名的核心节点件。所以 §十 的承诺严格说只到"区域词表内的新位置不改 `BaseNode.vue`"。

**`BaseNode.vue` 只改这一次**，之后所有"给节点加东西"都不用再碰它。

---

## 六、使用案例（伪代码）

> **读法**：以下代码用的是**本文提出的新 API**（`ctx.registryOf`、`ctx.state`、`ctx.nodes.attach`、`useNodeContext`、`useCapabilities`、`needs`、`props`）。它们**今天都还不存在**，属提案；其中 `ctx.state` 与 `registryOf` 由步骤 1 建立，`attach` 由步骤 3 建立。别拿这些代码去搜现有仓库。

### 案例 1 · 上栏加按钮 → 点开自定义下栏（作者的原始场景）

> 原话："给某个节点的上控制栏添加一个自定义渲染的组件按钮，点击之后显示自定义的下控制栏，这里你点击控制栏的按钮的时候需要提供完整的上下文。"

```ts
export const name = 'image-gen'

export function apply(ctx) {
  const 展开 = ctx.state(false)          // 插件自己的状态，不占服务名

  ctx.nodes.attach('image', {
    region: 'out:top',
    id: 'gen-button',
    component: GenButton,
    needs: ['node', 'zoom'],             // 声明要用哪些能力
    props: { 展开 },
  })

  ctx.nodes.attach('image', {
    region: 'out:bottom',
    id: 'gen-panel',
    component: GenPanel,
    needs: ['node', 'tools'],            // 要用 ctx.tools 里的文生图
    props: { 展开 },
  })
}
```

按钮组件里，一个 hook 拿到完整上下文：

```vue
<script setup>
const { id, type, data, update, zoom, selected, solo, attach } = useNodeContext()
const { 展开 } = defineProps()          // 由注册时 props 传进来的共享状态
</script>
<template>
  <!-- 注意：props 是只读的，改状态要写进它自己的 .value -->
  <button @click="展开.value = true">{{ data.label }}</button>
</template>
```

> **状态怎么传**：`ctx.state(x)` 返回 `{ value }` 对象，注册时放进 `props` 传下来，两个组件拿到的是
> **同一个对象**，于是一个改、另一个看得见。`props` 里传引用、不传值 —— 传 `展开.value` 就会断开联动。

### 案例 2 · 加进度条 —— 只换区域词

```ts
export const name = 'image-progress'

export function apply(ctx) {
  ctx.nodes.attach('image', {
    region: 'on:bottom',                 // 贴在卡片底边框线上
    id: 'progress',
    component: GenProgress,
    needs: ['node'],
  })
}
```

案例 1 与案例 2 的**核心一行没改**。

### 案例 3 · 换掉 BaseNode，但原值不丢（作者担心的那点）

> 原话："如果这里是替换的话不好办，因为如果我这里想获取指定插件注册的节点就没有办法了，他应该是一个列表或者是嵌套 map。"

```ts
export const name = 'my-theme'

export function apply(ctx) {
  // (a) 包住原来的：inner = **原来那个壳**（theme 槽给的默认壳、或别人先叠的那层）
  //     靠 resolve(key, base) 的 base 参数实现 —— 场外那份默认壳会作为最里层递给 wrap。
  ctx.registryOf('node/shell').wrap('*', (inner) => MyChrome(inner))

  // (b) 整个换掉：只是叠上去，原来那个照样查得到
  ctx.registryOf('node/shell').add('image', MyShell, { order: -10 })

  // (c) 想拿某个插件注册的壳？列表给你（含 source）
  const 全部 = ctx.registryOf('node/shell').list('image')
  // [{ id:'my-theme', source:'my-theme', value: MyShell }, …]
// （theme 槽那份默认壳不在场里，要它用 host.themeRegistry.winner('nodeShell')）
}
```

> **读取端在哪**（初稿漏写，实现时才补足）：`assembleTheme`（canvas-render）按
> ①场精确键 → ②场 `*` 通配 → ③theme 槽 `nodeShell:<type>` → ④theme 槽 `nodeShell`
> 的顺序解析每个 type 的壳，并把 ③/④ 那份当 `base` 递进 `resolve` —— 所以只写一行 `wrap`
> 也能拿到"原来那个壳"。运行期 `add`/`wrap` 经这张场的 `subscribe` 触发宿主重装配，即时生效。

### 案例 4 · 组件目录（作者要的"组件 Map"）

> 原话："我要用到按钮的时候就会到注册表中去找这个名称的组件进行渲染。"

```ts
// 主题插件登记设计系统
ctx.registryOf('ui').add('button', ThemeButton)
ctx.registryOf('ui').add('dropdown', ThemeDropdown)
ctx.registryOf('ui').add('slider', ThemeSlider)

// 任何插件按名字取，不 import 任何具体组件
const Button = ctx.registryOf('ui').top('button')
```

换一个主题插件，所有插件里的按钮一起变，业务插件一行不改。代价：打错字运行时才炸——用 TS 声明一次目录类型表 + dev 模式"名字不存在"告警补上。

### 案例 5 · 能力包（作者说的"很多 hooks 都是通用的"）

```ts
// 宿主/主题提供一套标准的
ctx.registryOf('capability').add('node', (nodeId) => createNodeCapability(ctx, nodeId))
ctx.registryOf('capability').add('zoom', () => createZoomCapability(ctx))
ctx.registryOf('capability').add('tools', () => createToolsCapability(ctx))

// 组件里：只给你 needs 里声明过的
const { data, update, zoom, tools } = useCapabilities()
```

不用重复实现 · 可测（测试塞假的）· 可换（主题换整套，组件不动）。

### 案例 6 · 注册工具 + 观察者插件（cordis 教程第 7 章那套）

**定案写法见 §7.3**（模型可调用工具走 `ctx.registryOf('tool')`，不是 `ctx.tools`）。两个插件互相不认识，由注册场 + 事件连起来。

> 今天这个观察者插件**写不出来**——`ToolRegistry` 一行事件都不发（`register/unregister/invoke` 全无 emit），全仓也搜不到任何 `tools/*` 事件。

### 案例 7 · 数据相关的管理（作者最早提的那点）

```ts
export const name = 'mini-map'

export function apply(ctx) {
  const 显隐 = ctx.state(true)           // 随插件自动回收，不占服务名

  ctx.registryOf('command').add('mini-map:toggle', {
    title: '切换小地图',
    keys: ['mod+m'],
    run: () => { 显隐.value = !显隐.value },
  })

  ctx.slots.register('overlay', { id: 'mini-map', component: MiniMap, props: { 显隐 } })
}
```

### 案例 8 · 插件 A 在插件 B 注册的东西上做封装（作者的原话场景）

> 原话："插件中还可以获取其他地方提供的插件，在他的基础上进行封装……通过上下文 api 拿到这里的 baseNode，然后我直接插件一个组件，里面就是继续这个 basenode 上进行封装。"

```ts
export const name = 'image-with-badge'

export function apply(ctx) {
  // 先看看别人往这个 type 上放过什么（不 import 对方的包）——只做诊断/条件判断用
  const 现有 = ctx.registryOf('node/shell').list('image') // [{ id, source, value }, …]

  // 在它外面套一层：inner = **下面那层**（别人先叠的，或 theme 槽给的默认壳）
  // 不需要先 top()/判空 —— 场为空时 inner 也会拿到 base（默认壳），所以这一行永远包得起来。
  ctx.registryOf('node/shell').wrap('image', (inner) => makeBadgedShell(inner))
}
```

**这是"不覆盖、只叠栈"真正的用途**：A 覆盖后，B 照样能拿到 A 那份并在它上面继续做。
注意 `top()` 取的是"场上最外那条"，**不含** theme 槽那份默认壳；要"完整合成的当前壳"用
`resolve(key, base)`（宿主 `assembleTheme` 正是这么读的）。

---

## 七、工具注册表与 cordis 教程第 7 章的差距

对照 `deepseek-harness/docs/cordis-tutorial/07-into-the-harness.zh.md`。

### 7.1 两章状态完全不同

**第 3 章（注册服务）：已 1:1 实现。**

| 教程要的 | 本仓现状 |
|---|---|
| `class X extends Service` + `super(ctx,name)` | `kernel/src/service.ts` ✅ |
| 注册是 effect、卸载即移除 | `scope` 回收 ✅ |
| `export const inject = ['x']` 硬依赖 + PENDING 等待 | `Context.depSatisfied` / `drain` ✅ |
| 提供方消失 → 依赖方回收、恢复 → 自动重载 | ✅ |
| `declare module` 声明合并 | ✅ |
| `ctx.get` 可选依赖探测 | ✅ `get` / `tryGet` |

**第 7 章（注册工具）：轴有，但不是同一等第。**

本仓的 `ctx.tools`（`kernel/src/toolRegistry.ts`）是**画布生成工具目录**（列模型、声明参数下拉、调后台、看进度），而教程的 `tools` 是**给模型调用的 function calling 注册表**。名字撞了，用途不同。

本仓在若干地方更强：`onProgress` 轮询归一、超时收敛、`produces`/`accepts` 筛选、参数可挂自定义组件（`ToolParamDef.component`）。

### 7.2 真缺口（四个，补在 `registryOf('tool')` 那套上）

1. **没有事件。** 全仓搜不到任何 `tools/*` 事件（`ToolRegistry` 的 register/unregister/invoke 全无 emit）。所以教程第 7 章的 `tool-logger` 观察者插件**今天根本无法实现**。（补时须同时 `registerEventName`，见 §7.4）
   → 补 `tools/registered`、`tools/unregistered`、`tools/result`（结果物化时发，在 `invoke` 返回前）。
2. **没有 `defineTool` 糖。** 现在是裸写 `ToolDef`。教程从 `parameters` 自动派生 JSON Schema。
   → 补 `defineTool`，把已有的 `ToolParamDef`（type/options/min/max/step/default 已能描述参数）转成 JSON Schema。**复用已有结构，不新造词表。**
3. **执行上下文缺 `callId` / `signal`。** `ToolRunContext` 现在只有 `nodeId` / `canvasId` 和一个索引签名。
   → 补 `callId`（关联一次调用）与 `signal`（可取消）。
4. **没有 `output.schema` + `output.render`。** 现在是 `ToolOutcome`，产物无规范化、无渲染器。
   → 补产物 schema 与 renderer，让结果可持久化。

### 7.3 命名决策

**两套工具都要保留，且必须分开名字。** 定案：

| 用途 | 今天 | 定案 | 为什么 |
|---|---|---|---|
| 画布生成工具（列模型、渲染参数下拉、调后台、看进度） | `ctx.tools` | **原地不动** | 两个工具插件 + 节点面板在用，改动最小 |
| 模型可调用的 function calling 工具 | **不存在** | **新增 `ctx.registryOf('tool')`** | 按规则 5，它本质是"一张表"，本就该是场 |

**所以 §7.2 那四个缺口全部补在注册场那套，不补在 `ctx.tools` 上**：`defineTool`（参数→JSON Schema）、`tools/result` 事件、`callId`/`signal`、`output.schema`+`render`。

> **勘误**：本文早期草稿把四个缺口写成"都在 `toolRegistry.ts`"、案例 6 又用 `inject=['tools']` + `ctx.tools.register(defineTool(...))`——那是把两套工具混成一套了。以本表为准：**案例 6 的正确写法见下**。

案例 6 的定案写法：

```ts
// 提供方：模型可调用工具 → 注册场
export function apply(ctx) {
  ctx.registryOf('tool').add('greet', defineTool({
    description: '打个招呼',
    parameters: { name: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, { callId, signal }) { return `Hello, ${args.name}!` },
  }))
}

// 观察者：监听场的变化 + 调用结果事件（不 inject 'tools'）
export function apply(ctx) {
  ctx.on('tools/result', (exec, result) => console.log(exec.name, result.content))
}
```

### 7.4 补事件必须同时登记事件名（否则违反"零 warn"）

`EventBus.emit` 对**未登记**的事件名会 `console.warn`（`EventBus.ts:72-75`），而运行时登记表初始只有 4 个 `ctx:*`（`knownEvents`，`EventBus.ts:144`）——编译期的 `interface Events` 不进运行时表。

所以新增 `tools/result` 等事件时，**必须同时**做两件事：

1. 在 `interface Events` 里 declare（拿类型提示）；
2. 在模块加载时调 `registerEventName('tools/result')`（消除 warn）。

否则 §十 验收的"零 error、warn 仅限既有白名单"不成立。

---

## 八、命名冲突与兼容（实现前必读）

### 8.1 注册场入口叫 `ctx.registryOf`

`ctx.registry` 已被插件运行态诊断占用（四处：`Context.ts:498`、`Context.ts:668`、`types.ts:175`、`cordisParity.test.ts` 的 7 处断言）。**定案与理由见 §十一 决策 6**：注册场入口取名 `ctx.registryOf(kind)`，诊断名原样不动，零冲突、零测试改动。

**勘误**：本节早期草稿曾建议"诊断改名、把 `registry` 让给注册场"，并低估占用面为"两处"。该建议已否决（会打破决策 8 的"测试一条不删"，也放弃了一条 cordis parity）。

### 8.2 老 API 的兼容映射

以下老写法在迁移期必须继续可用（否则 24 个插件与全部测试同时红）：

| 老写法 | 糖落到哪个场 | **必须保留的行为**（否则既有测试红） |
|---|---|---|
| `ctx.nodes.register(def)` | 只写真实容器（`doc` 类型表 + `nodeRegistry`；`node/type` / `node/creator` 场已删） | 返回 `void`；`create` 会挂进内部工厂；卸载自动回收。（⚠️ 2026-09-19：不再往 `node/shell` 写"展示定义摘要" —— §4.5 定义这张场的值是**壳组件**、消费者是节点壳装配；写摘要会被装配端当成组件渲染而整图崩。摘要本就在 nodeRegistry / node/region 里。） |
| `ctx.nodes.contribute(type, seg, comp, opts)` | `node/region/<type>/<seg>` | **返回 occupant id（string）**；缺省 order = "已有最大 + 1"（`nodeRegistry.ts:137`） |
| `ctx.theme.register(slot, comp, opts)` | 只写 `ThemeRegistry`（`theme` 场已删） | **同槽重复 register 抛错**（`already registered`，`themeRegistry.ts:102`，测试断言此行为）；`winner` = order 最小者 |
| `ctx.commands.register(def)` | `command/<id>` | 重复 id 抛错；返回可 dispose 的句柄 |
| `ctx.slots.register(slot, req)` | 只写 `SlotRegistry`（`slot` 场已删，且场会丢 `meta`） | **返回 id（string）**——`plugin-align-guide` 等据此 `remove` |
| `ctx.settings.*` | 只写 `SettingsStore`（`setting` 场已删） | `define/set/get/onChange/groups` 现有语义不变 |
| `ctx.tools.register(def)` | **保持服务**（见 §7.3） | 不动 |

**关键裁决（初稿没说清，会直接撞既有测试）**：注册场的 `add` 是"同 id 替换"，而 `ctx.theme.register` **同槽重复抛错**。两者语义不同，所以**糖不是薄转发**——糖要在转发前做自己的校验（`theme` 糖先查 `has` 再 `add`，命中则抛错）。这条必须写进实现，否则 `themeRegistry.test.ts` 的两条断言会红。

**外表不变、地基换掉**：名字全留着，底下只有一套机制。这样迁移是**分批**的，不是一次大爆炸。

### 8.3 一等 API `ctx.nodes.attach` 的签名（初稿只在案例里用过、从未定义）

案例 1/2 用的 `attach` 全文没有定义。定死如下：

```ts
// 位置进「键」而不是「字段」——这样一处位置就是一个场，list/top/wrap 全都直接可用
ctx.nodes.attach(type: string | '*', req: {
  region: NodeRegion          // 'in' | 'title' | 'out:top' | … 十个之一
  id?: string                 // 缺省 = 当前插件名（同插件重装即替换）
  order?: number              // 小 = 在外；缺省 0
  component: unknown          // opaque 组件句柄
  needs?: string[]            // 要用哪些能力包（见决策 9）
  props?: Record<string, unknown>   // 组件专属数据（规则 3）
}): Disposable

// 落到：registryOf('node/region')，键 = `${type}/${region}`
// 于是 list('node/region/image/out:top') 拿该位置整摞，wrap 同键即"包住下一层"
```

**为什么位置进键而不是进 `value`**：进键才能让 `list`/`top`/`wrap` 直接作用于"某个节点的某个位置"，不必在每次读取时过滤。`needs`/`props` 进 `value`（它们是这条目自己的数据）。

---

## 九、迁移步骤（每步可独立验证）

按"铺底子 → 搬窝 → 收尾"分三组。**前 2 步行为零变化；第 3 步只加渲染位**（老五段的渲染结果不变，新增五个区域的渲染位）；第 4 步起才动装配。

### 第一组：铺底子（步骤 1–2 纯新增零变化；步骤 3 只加渲染位）

**步骤 1 · 立两个缺失的原语：注册场 + 状态。**

注册场：
- 在 `kernel` 里新增 `Registry<T>` 接口与实现（基于已有的 `SlotRegistry` 扩展，补齐 §2.1 的全部成员：`add`/`remove`/`clear`/`clearByPrefix`/`list`/`top`/`get`/`has`/`ids`/`keys`/`wrap`/`resolve`/`subscribe`）。
- 在 `Context` 上挂 `registryOf(kind)`（决策 6）。

状态（**初稿漏了这一步**：§二 把 `ctx.state` 列为原语、§4.3 与多个案例都在用它，但全文没有任何一步创建它——照初稿做会卡住）：
- 在 `Context` 上新增 `state<T>(initial: T): State<T>`。
- 语义定死：`State<T> = { value: T }`（响应式由渲染层决定，内核只存值）；**随所属插件 scope 自动回收**（走 `ctx.effect`）；插件卸载后该状态不再可达。
- 为什么不占服务名：它是插件私有数据，不是"别人按名取的能力"（规则 7）。

- **完成标准**：新增单测覆盖注册场的 `add`/`list`/`top`/`wrap`/`resolve`/`subscribe`/`remove`/`has`/`ids`（含"同 id 替换""栈序 = order 升序从外到里""wrap 收到 inner""卸载自动回收"），以及 `ctx.state` 的"作用域回收""两插件互不可见""值可读写"。**既有测试全绿、一条不删。**

> ⚠️ **关键坑：插件 scope 是个 Proxy，新成员必须显式挂到 target 上。**
> `Context.deriveScope()` 返回的插件 `ctx` 是 `new Proxy(api, …)`（`Context.ts:686-697`），它的 `get` 逻辑是：
> **`prop in target` 才走真实成员；否则一律当成"服务名"去查服务表**（查不到返回 `undefined`，不报错）。
> 所以新增的 `registryOf` / `state` / `isDev` **必须 `Object.assign` 进同一个 `api` 对象**（与现有
> `buildToolSegment` / `buildSegments` 的挂法一致）。漏挂的后果是**插件里调用静默返回 `undefined`**
> ——不抛错、难定位。这一步的实现与测试都要盯住它（测试用例里直接调 `ctx.registryOf(...)` 就能暴露）。

**步骤 2 · 老注册表改成场的封装。**
- `ctx.commands` / `ctx.slots` / `ctx.settings` / `ctx.nodes` / `ctx.theme` 全部转发到注册场。
- **完成标准**：**行为零变化**——所有既有测试原样全绿，一条不删不改（各包当前基线数字以 `docs/STATUS.md` 为准，落地时先复跑一遍记录在案）。

**步骤 3 · `BaseNode.vue` 改成按区域遍历。**
- 十个区域词全部落地；现有五个段（content/title/top-toolbar/bottom-toolbar/overlay）映射到 `in`/`title`/`out:top`/`out:bottom`/`over:inset`。
- 新增 `out:left`/`out:right`/`on:top`/`on:bottom`/`over:outset` 五个区域的渲染位
  （五个老段 = `in`/`title`/`out:top`/`out:bottom`/`over:inset`，五个新区域合计十个区域词）。
- **完成标准**：① 五个老段全部映射后，既有节点外观与行为**目视一致**（截图留档对比，不要求逐像素自动比对——仓库无此设施）；② 十个区域各有一个最小挂件渲染成功；③ 既有测试一条不删、全绿。

### 第二组：搬窝（价值最高，风险最高）

**步骤 4 · 建基础插件，收编 15 行装配。**
- 新增 `canvasBasePlugin`：在它自己的 `apply(ctx)` 里建那 15 个零件，并声明 `core: true`（决策 1）。
- `createMiniCanvasHost` 缩成"建 ctx → 装基础插件 → 装业务插件 → start"。
- **完成标准**：① `createMiniCanvasHost.ts` 里的 `ctx.inject` 从 15 处降到 ≤2；② `ctx.uninstallPlugin('canvas-base')` 返回 `false` 且画布功能不受影响；③ 换一个宿主（测试里用一个 headless 装配）能跑通建节点/撤销/落盘全链。

**步骤 5 · 服务合并。**
这一步是唯一真正改行为的，**分三段做，每段可单独回退**：

**5a · 加 `doc` 外观（纯新增）。** 新增 `doc` 服务，内部委托现有的 `nodeStore`/`edgeStore`/`graph`/`history`；**老服务名全部保留**（`doc` 是它们的门面）。→ 此时新老并存，零行为变化。

**5b · 逐个改消费方。** 把 16 个插件文件的 `inject` 与 25 个文件的 `ctx.inject('nodeStore')` 式装配逐个改到 `doc`。每改一批跑一次测试。→ 老名此时是"只有测试与漏网文件在用"。

**5c · 删老名。** `nodeStore`/`edgeStore`/`graph`/`history` 四个名字下线。

其余清理（按决策 10 的范围）：删 `menu` 服务（实现合回 `plugin-context-menu`）；`settingsPersist` 收回 `save` 内部；`image-meta` 删；`shortcut-remap`/`history-facade`/`mini-map`/`auto-save` 收回各插件内部（用 `ctx.state` 替代）。

- **完成标准**：基础服务数 = 7；**已知要改的测试**（见决策 8 例外清单）改完、其余一条不删；浏览器端到端（建/连/删/撤销/刷新恢复/设置面板）零控制台 error。

### 第三组：补缺口与收尾

**步骤 6 · 补工具那 4 个缺口。**（§7.2）
- **完成标准**：教程第 7 章的 `tool-logger` 观察者插件能真实跑起来并打印每次调用。

**步骤 7 · 拆掉插件包循环依赖。**
**准确名单**（初稿写错）：`plugin-theme-default` 与 **`plugin-node-text`**、**`plugin-node-image`**、**`plugin-node-video`** 互指（theme-default 的 devDeps 含 node-image/node-text；node-video 也依赖 theme-default）。**`plugin-multi-select` 不在名单里**——它依赖 theme-default，但 theme-default 不依赖它，不成环（`BaseNode.vue` 只是读它声明的配置 key，不是包依赖）。

- 复用件（`MovingHandle`/`ConnectionLine` 等交互件）改由**独立场**提供，与 `ui`（设计系统换皮件）分开——见决策 4，塞进 `ui` 会把"目录 = 可换皮"的判据搅浑。
- **完成标准**：用能真查环的命令验证，如 `npx madge --circular packages/plugins/plugin-theme-default/src`（`pnpm ls --depth -1` 只列直接依赖，查不出环）。

**步骤 8 · 收口 `ui` 与两个后端。**
- `packages/ui` 补真正入口文件（`main` 指向的 `src/index.ts` **不存在**）+ 把装配清单移出 `App.vue`（实测 `App.vue` 装 **21** 个插件；`packages/plugins` 目录 24 个，未装配的 3 个是 `plugin-auto-save`/`plugin-cloud-save`/`plugin-history`）。
- `cloud-server` / `mcp-server` 共用的画布模型考虑复用数据层。**注意因果**：`canvas-data` 本身零 Vue、可 headless 单测，阻碍复用的**不是能力缺失**，而是"两个后端要能独立 `npx` 跑"这条打包决定（`canvasDoc.ts:18` 明说不 import private 工作区包）。所以这一步的**前提是先把 `canvas-data` 做成可发布**，与步骤 4 无关。

**步骤 9 · 删垫片（决策 3 的终点）。**
- 删掉老五个段位词（`content`/`title`/`top-toolbar`/`bottom-toolbar`/`overlay`）的兼容映射，老词改为**类型报错**。
- **完成标准**：全仓 `rg` 搜不到老词作为注册用法；类型检查通过。步骤 9 不做完，决策 3 不算完成（否则垫片永久化，正是作者原始抱怨的病）。

---

### 回退方案（初稿整章缺失）

每一步都必须是"可独立回退"的原子提交，回退手段：

| 步骤 | 回退点 | 回退方式 |
|---|---|---|
| 1 / 2 / 3 | 各自一个提交 | `git revert` 该提交即可（纯新增 / 薄转发 / 只加渲染位，互不依赖） |
| 4 | 一个提交 | revert（基础插件是新增，宿主的旧装配在 diff 里可完整恢复） |
| 5a / 5b / 5c | **三个独立提交**（见步骤 5 分段） | 5c 最危险（删老名），前两段都可单独 revert；5b 建议按插件分批再提交 |
| 6 | 纯新增 | revert |
| 7 / 8 / 9 | 各自一个提交 | revert；步骤 9 若引起问题，恢复垫片即可 |

**动手前必须先做的两件事**：

1. 在分支上做（`codex/` 前缀），不直接改 `main`。
2. **先补回 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`**——`AGENTS.md` 要求"改核心节点件前先读它"，多份代码注释也引用它，但**该目录今天是空的**。步骤 3 要改 `BaseNode.vue`，没有这份契约金标准就不该动手。

---

## 十、验收总清单

全部满足才算这套设计落地。

**分层**
- [ ] 基础服务数 = 7（`tools`/`doc`/`selection`/`save`/`resources`/`nodeLayout`/`viewport`）
- [ ] `kernel` 依赖为零；结构上不认识画布概念（`command.ts` 的 `areas` 注释里出现 `node/edge/pane/toolbar` 字样属既有注释，按"结构"而非"字符串"判定）
- [ ] `canvas-render` 只认 DOM/vue-flow 那两个服务
- [ ] 任何基础服务都能被第二个宿主复用，无需抄装配代码

**扩展**
- [ ] **区域词表内**加新的 UI 位置不需要改 `BaseNode.vue`（表外的全新物理位置仍需改壳，见 §五）
- [ ] 新增一类扩展点 = 一行 `ctx.registryOf('新种类')`，不是新的 `ctx.inject`
- [ ] 覆盖永不丢原值：`list()` 永远能查到所有历史层，`wrap()` 能拿到 `inner`
- [x] 目录化（`ui` 场）：换主题插件，业务插件一行不改
      **（已完成，commit efa6e5c）** `uiCatalog.ts` 提供 `uiComponent/useUiComponent/uiNames`；
      theme-default 登记 button/dropdown/select/slider/toolParamField；e2e 锁"按键可枚举 + 叠层换主题"。
- [x] 能力包：组件 `needs` 声明即可用，测试可注入假能力
      **（已完成，commit d6dffae + a14b27a）** `capabilities.ts`（`createCapabilityCache`
      —— **每节点一份实例**，同一节点上"按钮"与"它打开的面板"拿到同一个实例）+ `RegionEntryHost.vue`
      （按条目 needs 取袋 + provide）+ 宿主标准四件（node/zoom/selected/tools）。
      决策 9 三件事全落地（任何插件可注册 / 每节点一份由消费方回收 / dev 抛错 prod warn）。
      测试：capabilities 13 条 + SSR 端到端 6 条 + e2e 2 条。

**可诊断**
- [ ] 任何一条注册都能查出 `source`（谁放的）
- [ ] 插件热卸后，它的全部注册（场 + 服务 + 事件 + 状态）一条不留

**行为不回退**
- [ ] 全量测试绿（基线见 `docs/STATUS.md`）
- [ ] 浏览器端到端：建节点 / 拖动 / 连线 / 删除 / 撤销重做 / 刷新恢复 / 设置面板改动实时生效，**零 error**；
      warn 仅允许既有白名单提示（注意：`EventBus` 对未用 `registerEventName` 登记的事件名会 warn，见 §7.4）

- [ ] 插件环依赖已拆（`madge --circular` 无环）
- [ ] 区域词垫片已删（步骤 9 完成，老词为类型报错）

**工具**
- [ ] `tools/result` 事件可用，观察者插件能跑；事件名已 `registerEventName`（否则 dev 下 warn）
- [ ] `defineTool` 能从 `parameters` 派生 JSON Schema（落在 `registryOf('tool')`，不是 `ctx.tools`）
- [ ] 调用可关联（`callId`）、可取消（`signal`）

---

## 十一、决策记录

本章每条都是**已定结论**，不再留给实现时临场发挥。标注 `【待审批】` 的由我自决，等你点头；标注 `【已定】` 的来自你的原话或既有约束。

### 决策 1 · 核心插件不可热卸 —— 用一个标识 `core` 【待审批】

**你的原话**：

> "有些功能插件功能其实是核心需要的、不能动态卸载的，你提供一个标识就行，让插件管理系统无法卸载他。"

**为什么必须**：现语义是"提供方一卸，依赖它的插件全部回退 PENDING"（`Context.retractUnsatisfiedActives`）。若 `doc` 由普通插件提供，它一被卸，复制粘贴/分组/多选全停摆 —— 画布直接瘫。所以"谁能被卸"必须有答案，这是整套改造的技术核心。

**定案**：给插件一个布尔标识 `core`。被标记者**拒绝动态卸载**。

**标识怎么给（两种形态都要支持，因为插件有两种写法）**：

```ts
// 对象形态
export const core = true
export default { name: 'canvas-base', core: true, inject: [], apply(ctx) {…} }

// 类形态（Service 子类）
export class DocService extends Service {
  static core = true
  constructor(ctx) { super(ctx, 'doc') }
}
```

`asPluginModule()` 归一两种形态时把 `core` 透传进 `PluginModule`。**必须改三处**（不是一处）：

1. `types.ts` 的 `PluginModule` 加 `core?: boolean` 字段（`types.ts:204`）；
2. `pluginClass.ts` 的类形态分支——今天**新建对象时只拷 `name/inject/Config/apply`**（`pluginClass.ts:62-67`），`static core` 会被丢掉，必须一起带上；
3. `Context.uninstallPlugin` 加守卫（权威拦截点）。

另加 `inspectPlugins()` 的每项带 `core?: boolean`（`Context.ts` 的 `PluginRuntimeStatus`），供 UI 禁用卸载按钮。

**拦截范围（精确边界，不含糊）**：

**守卫放在 `Context.uninstallPlugin` 一处**（唯一权威），但**调用方必须各自处理"被拦"**——因为 `pluginManager` 今天在被拦之后还会继续做事，那会出问题：

| 入口 | core 插件时的行为 | 需要一起改的地方 |
|---|---|---|
| `ctx.uninstallPlugin(name)` | **拦**：返回 `false`，不 dispose fiber、不发 `ctx:plugin-uninstalled`、不触发 `retractUnsatisfiedActives` | kernel 一处守卫 |
| `manager.uninstall(name)` | **拦** | `pluginManager.ts:187-190` 今天**先 `configs.delete(name)` 再转调**——若被拦，config 已被删（副作用）。改为：**先问内核能否卸，能卸再删 config** |
| `manager.reload(name, next)` | **拦** | `pluginManager.ts:192-203`：`reload(name)` 无 next 时先 `configs.delete` 再卸（同上）；**`reload(name, next)` 是硬 bug**——它 `uninstallPlugin`（被拦、返回 false）之后仍继续 `installPlugin(mod)`，而旧插件还在 → 抛 `[core] Duplicate plugin name`。改为：卸不动就直接返回并**明确抛**"核心插件不可热替换" |
| `manager.install(source)` 同名覆盖 | **拦** | `pluginManager.ts:156` `installOne` 里 `if (listPlugins().includes(name)) ctx.uninstallPlugin(name)`——被拦后仍继续 `installPlugin` → 同一个重名抛错。改为：卸不动就抛"核心插件不能被同名实现覆盖" |
| `ctx.plugin()` 重复名 | 不受影响（`created` 期装配，不是运行中热卸；重复名照旧抛错） | — |
| `ctx.stop()` / `stopAsync()` | **不拦**。整体生命周期终结，不是"动态卸载"；页面关闭时核心插件也必须正常回收 | — |

**返回值定案**：

- `ctx.uninstallPlugin(name)`：沿用现有契约返回 **`false`**（"没卸到"）。**但它与"插件不存在"同值**——这个歧义由下一步解决。
- 新增 `ctx.canUninstall(name): { ok: true } | { ok: false; reason: 'core' | 'not-found' | 'not-started' }`，供**调用方先问再动**（`pluginManager` 与宿主 UI 都用它），从根上避免"先删 config 再发现卸不动"这类副作用。
- `manager` 层遇到核心插件**明确抛错**（消息含"core plugin cannot be uninstalled"），而不是静默 `false`——manager 是应用层友好句柄，静默失败更难查。

**可诊断**：`inspectPlugins()` 的每项加 `core?: boolean`，宿主 UI 据此**禁用卸载按钮**（而不是等用户点了才拒绝）。

**明确不做**：宿主给第三方插件"追认"核心身份（如 `ctx.sealCore(name)`）。你的要求是"提供一个标识"，插件自己声明即可；宿主若想让某插件不可卸，让那个插件声明就行了。少一个 API 少一个坑。

**与决策 2 的关系**：本条只管"谁能被卸"；下面那条管"多层叠加时谁在外"。两件事，别混。

**验收测试（步骤 4 必须带上，逐条对号）**：

| # | 用例 | 期望 |
|---|---|---|
| 1 | `uninstallPlugin('canvas-base')` | 返回 `false`；名字仍在 `listPlugins()`；fiber 仍 `active`；它提供的服务仍可用 |
| 2 | 核心插件的 `ctx.effect` 清理 | 未遂卸载后**一次都没跑**；`ctx.stop()` 后正常跑一次 |
| 3 | 普通插件 | 照常卸得掉（返回 `true`、服务消失）——守卫不能误伤 |
| 4 | 依赖核心插件的消费方 | 未遂卸载后仍 `active`，`missingDeps` 为空，事件照常收到——**没被连带回退 PENDING** |
| 5 | 类形态 `static core = true` | 同样拒卸；**先断言它真装上了**（否则 `false` 是"找不到"而非"被拦"，测试假绿） |
| 6 | `inspectPlugins()` | core 插件每项带 `core: true`，普通插件不带——供 UI 禁用卸载按钮 |

### 决策 2 · 栈序方向：`order` 小者在外（维持现状） 【待审批】

**定案**：

> **`order` 数字小者在最外层，负责覆盖；`list()` 按 `order` 升序 = 从外到里；`top()` = `order` 最小者。后注册者同 `order` 时排在后（不覆盖），想要覆盖就显式给更小的 `order`。**

**为什么维持现状而不改成"后注册者在外"**（原方案，已否决）：

1. 现状就是 `order` 小者赢：`ThemeRegistry.winner()` = `SlotRegistry.first()` = `list()[0]`（`themeRegistry.ts:70`、`slotRegistry.ts:106-113`），且 `theme-default` 的 `settingsPanel` 已按这个约定注册（`{order: 0}`，注释写明"装个 order 更小的插件即顶替"）。
2. 改成"后注册者在外的缺省语义"，会让**所有靠注册序决定顺序的地方反转**，而决策 8 要求步骤 1/2/3 既有测试一条不删——两者直接冲突。
3. "显式给 order 覆盖"本身就是已有且清晰的心智（插件作者写 `order: -1` 顶替默认皮），不需要新约定。

**必须知道的既有不统一（迁移时要逐处核）**：现状 `order` 缺省值在两个注册表里**方向相反**——

| 注册表 | 缺省 order | 效果 |
|---|---|---|
| `SlotRegistry` / `ThemeRegistry` | `0`（`DEFAULT_ORDER = 0`） | 后装同 order → 排在后面（`Array.sort` 稳定），**不覆盖** |
| `NodeRegistry.registerContribution` | "已有最大 order + 1"（`nodeRegistry.ts:137-143`） | 后注册**排在后**，叠加层在基座之后 |

统一到场的 `add()` 之后，缺省一律取 `0`（同 `SlotRegistry`），节点段那份"最大 + 1"逻辑由**节点注册表的糖**保留（它是节点的语义，不是场的语义）。

**这是本次最容易埋雷处**，由决策 8 的"既有测试一条不删"兜住。

### 决策 3 · 老五个段位词一次性迁 + 兼容映射 【待审批】

`content` / `title` / `top-toolbar` / `bottom-toolbar` / `overlay` 五个词**一次迁完**到区域词，同时留一层映射垫片：

| 老词 | 新区域 |
|---|---|
| `content` | `in` |
| `title` | `title` |
| `top-toolbar` | `out:top` |
| `bottom-toolbar` | `out:bottom` |
| `overlay` | `over:inset` |

垫片存在期间，老写法照常工作；**它的寿命是"迁移期"，不是长期**（留两套语义就是下一个"分不清谁是谁"）。

**退役安排（必须有终点，否则垫片会永久化）**：新增**步骤 9 · 删垫片**——老词改为类型报错（编译期拦住新用法），全仓不留老词。步骤 9 未完成，本条不算完成。

**不能删的东西**：`plugin-context-menu/src/menuBuilder.ts` 里的 `ContextMenuItem` / `ContextMenuMode` 等**类型**有 5 个文件在用（`connectionMenu.ts`、`ContextMenu.vue`、`ConnectionMenuContent.vue`、`menuEnrich.ts`、`contextMenuPlugin.ts`），删 `buildMenuItems` 函数时只删函数，类型保留。

### 决策 4 · 组件目录只给"想被换皮的"用 【待审批】

`ui` 场（按钮/下拉/滑块/图标这类设计系统件）**只收"希望被主题插件整体换掉"的组件**。插件内部自用的小组件照旧 `import`。

理由：全面目录化 = 整个框架变字符串驱动，打错字运行时才炸、丢类型提示，问题更难查。

### 决策 5 · 两套 tools 分开命名 【待审批】

你的 `ctx.tools` 今天承担的是**画布生成工具目录**（列模型、渲染参数、调后台、看进度）；cordis 教程第 7 章的 `tools` 是**给模型调用的 function calling 注册表**。名字撞了、用途不同。

定案：

| 用途 | 归谁 | 名字 |
|---|---|---|
| 画布生成工具（换实现） | 服务 | **保留 `ctx.tools`**（改动最小） |
| 模型可调用工具（一张表） | 注册场 | **`ctx.registryOf('tool')`** |

按规则 5，后者本质是"一张表"，本就该是场，不是服务。

### 决策 6 · 注册场入口改叫 `ctx.registryOf()`（诊断名不动） 【待审批】

`ctx.registry` 今天已被占用，且**占用面比初稿写的宽得多**——初稿只说"两处"，实际是四处：

| # | 位置 | 内容 |
|---|---|---|
| 1 | `Context.ts:498` | 只读 getter（插件运行态诊断） |
| 2 | `Context.ts:668` | 插件 scope 代理上的转发 `get registry() { return ctx.registry }` |
| 3 | `types.ts:175` | `PluginScope` 接口上的 `readonly registry` 类型声明 |
| 4 | `canvas-data/src/canvas/__tests__/cordisParity.test.ts` | **7 处** `ctx.registry.keys()/.get(...)` 断言，标题为"能力④ ctx.registry（cordis 06 诊断）" |

**原来的方案（诊断改名、把 `registry` 让给注册场）已否决**，三条理由：

1. 它与**决策 8** 直接冲突——步骤 1 声称"纯新增、行为零变化"，改名却会让 `cordisParity.test.ts` 变红，必改测试。
2. `ctx.registry` 是 **cordis 06 教程的既有名字**，而本文 §一 把"与 cordis 1:1 对齐"当卖点。改掉它等于主动放弃一条对齐能力。
3. 初稿低估了改动面（4 处，含 7 个测试断言），"用得少、可接受"这个判断不成立。

**定案**：注册场入口叫 **`ctx.registryOf(kind)`**。

- 理由：`registryOf('node/shell')` 读起来就是"取 node/shell 的注册场"，语义直白；与 `ctx.on`/`ctx.effect` 并列不别扭；零冲突、零测试改动，步骤 1 真的是纯新增。
- 糖的形态不变（`ctx.nodes` / `ctx.theme` / `ctx.commands` / `ctx.slots` / `ctx.settings`），它们是 `registryOf(...)` 的短写法，作者日常不直接写 `registryOf`。
- 若日后仍想把它叫 `registry`，作为**独立后续任务**处理（那时才动那 4 处 + 测试），不塞进本次迁移的第一步。

### 决策 7 · v1 老包 `packages/canvas-core` 不碰 【已定】

`AGENTS.md` 的红线：不碰 `src/` 与老版宿主。本次全部改动发生在 `kernel` / `canvas-data` / `canvas-render` / `plugins` / `ui`。若日后确认 v1 淘汰，另开任务移除。

### 决策 8 · 不改行为的那三步必须"测试一条不删" 【待审批】

步骤 1/2/3 的验收不是"新测试通过"，而是**既有测试原样全绿**（一条不删、不改、不跳过）。

理由：这三步是"地基换掉、外表不变"，任何既有测试需要修改，都说明行为变了 —— 那就不是重构，是改功能。把"测试一条不删"当硬门槛，能强制暴露意外改动。

**例外清单（必须承认的现实）**：以下改动**一定要碰测试**，属本决策之外的已知例外，实现时要一并列出并在提交信息里写明：

| 步骤 | 要改的测试 | 为什么 |
|---|---|---|
| 步骤 5 | `nodeTypeIcon.test.ts`（2 处 `ctx.get('menu')`）、`plugin-context-menu` 的 `inject` | 删 `menu` 服务必然牵动 |
| 步骤 7 | 各插件包 import 路径 | 复用件换提供者 |

除这几条外，多改一条测试就要先问清楚为什么。

### 决策 9 · 能力包的所有权与缺失行为 【待审批】

案例 5 用了 `ctx.registryOf('capability')`，但初稿没说清三件事，不写清 24 个插件会各写一套。定案：

**① 谁有权注册能力。** 不设"只有宿主能注册"的限制——任何插件都能注册（与 cordis「任何插件都能提供服务」一致）。**实际冲突按 order 裁决**：order 小者在外、优先被 `top` 取到，所以"主题插件换掉整套能力"就是叠一个更小 order 的条目。

**② 实例作用域与回收。** 能力工厂 `(nodeId) => Capability` **每节点一份实例**（**同一节点**上所有声明了同名 `needs` 的条目共享同一份 —— 否则"按钮"与"它打开的面板"各拿一个实例，状态不共享，正是本条要解决的重复）。实例由**消费它的组件**负责回收：落地上就是 BaseNode 持有 `createCapabilityCache`、`onBeforeUnmount` 时 `dispose()` 统一回收（工厂返回的对象有 `dispose()`/`stop()` 就顺手调一次）。工厂本身由注册者持有、随注册者 fiber 回收。能力被热换（同键叠了新的更小 order 条目）时缓存按"产出它的工厂引用变了"自动重造，并把旧实例先回收。

**③ `needs` 缺项时的行为。** 定死（避免静默半运行）：

| 环境 | 行为 |
|---|---|
| dev（`ctx.isDev === true`） | **抛错**，消息写明缺哪个能力、谁声明的 `needs` |
| prod | `undefined`，组件自己判空降级；同时 `console.warn` 一条 |

理由：dev 要"响亮"（这是作者抱怨的"静默不生效"的解药），prod 不能让缺一个能力就白屏。

> ⚠️ **`ctx.isDev` 今天不存在**：内核里那个是 `private dev`（`Context.ts:151`），插件作用域读不到。
> 步骤 1 要把它一并补成公开成员（连同 `registryOf` / `state` 一起挂，见步骤 1 的"Proxy 注意"）。
>
> ✅ **2026-09-19 已落地并接通**（commit 61f3180）：`ctx.isDev` 早就公开可读，但**真实宿主里恒为 false**
> —— vite 的 `import.meta.env` 替换只作用于应用包自身源码，canvas-render 作为 workspace 包读不到替换，
> 所以"库里自己读 env"这条走不通，dev 分支一直是死代码。改为 `MiniCanvasOptions.dev` /
> `CanvasHost` 的 `:dev`，由 `@mini-canvas/ui` 的 App.vue 显式传 `import.meta.env.DEV`；
> 缺省 false = 生产语义（库不悄悄依赖打包器全局变量）。e2e 已加"dev 开关接通"断言。
> 接通后当场暴露另一处同类缺陷：`RenderEvents` 等事件名从未 `registerEventName`（§7.4），已全部补齐。

### 决策 10 · 删除 `menu` 的准确范围 【待审批】

初稿写"`menu` 删掉（合回 `plugin-context-menu`，清掉那份已成死代码的 `menuBuilder.buildMenuItems`）"——**自相矛盾**："合回"意味着那个函数**复活**，不再是死代码。定案：

- **删**：`canvas-data/src/canvas/menuService.ts`（`createMenuService` / `MenuService`）与宿主那行 `ctx.inject('menu', menu)`。
- **保留并启用**：`plugin-context-menu/src/menuBuilder.ts` 的 `buildMenuItems`——它就是"合回"后的实现，**复活为生产代码**（今天只有测试在调它）。
- **保留（不能删）**：同文件的 `ContextMenuItem` / `ContextMenuMode` 等**类型**，有 5 个文件在 import。
- **理由订正**：不是"只被一个插件消费"（`menuService.ts:5` 的注释说它是为"工具栏/面板复用"才搬出去的），而是**它服务的那一个消费者可以自己实现，且实现已经在它自己的包里**。判据是"谁能更好地实现它"，不是"几个消费者"。

---

## 十一·补：自省 API `ctx.surface()`（列出注册了什么）

用户需求原话："很多工具有 get、register……希望你提供一个可以列出注册的列表，最好提供它们支持的参数函数"。

三根轴各有一个"往里放"的 API，但此前没有统一的"读出来"。新增 `ctx.surface()`（kernel，步骤 1 原语的自然延伸）：

```ts
const s = ctx.surface();   // 只读快照，零副作用，created/started 皆可调
s.state;                   // ctx 状态
s.services;                // 服务轴：[{ name, source }] —— 按名可取的全部服务 + 谁注入的
s.registries;              // 注册轴：[{ kind, keys, entries }] —— 每个场有哪些键、几条
s.registryEntries;         // 明细：[{ kind, key, id, order, source, fields? }] —— 每条谁放的、值有哪些可读字段
s.commands;                // 命令语义视图：[{ id, title, keys, areas, group, order, source }]
s.tools;                   // 生成工具：[{ name, title, params, produces, accepts, ... }]
s.modelTools;              // 模型可调用工具：[{ name, description, parameters, outputSchema, source }]
s.events;                  // 事件轴：已登记的事件名（沿 registerEventName 登记表）
```

要点：
1. services 含插件 provide 的（source = 插件名）；`tools` 是内核内置服务，不在 services 列表而在 `s.tools`。
2. `commands` / `modelTools` 是**语义视图**：从 `command` / `tool` 两个场把值拆成可读字段，不是独立存储。
3. `ctx` 与插件 scope 上都可用（deriveScope 显式挂载，防 Proxy 漏挂静默 undefined）。
4. 典型用途：诊断面板树、`console.table(ctx.surface().commands)`、AI 探查"现在有哪些工具可调"。
5. **`fields`**（条目轴，2026-09-19 补）：值顶层的**字段名**清单（best-effort，不是稳定契约）。
   回答作者最常问的那句"别人注册那条**有什么可读的**"（例如 node/region 条目的 needs/props），
   同时**不摊值**（值里可能有组件句柄/函数，摊出去既读不完也会泄漏）。非朴素对象（函数 / 类实例 / 原始值）不给。
6. **`events`**（事件轴，2026-09-19 补）：`registerEventName` 的登记表只进不出，作者想问"能监听什么"
   只能翻源码。补这条轴后，"有哪些事件"与 dev 的"未登记事件名会 warn"共用同一份清单。

## 十二、术语表（防止再次混淆）

| 词 | 定义 | 反例 |
|---|---|---|
| **服务** | 按名字取一个对象；会换实现 | 别把"一张表"叫服务 |
| **注册场 / 场** | 按种类放/取一串条目；`ctx.registryOf(kind)` 取用，不占服务名 | 别把"会做事的能力"叫场 |
| **条目 Entry** | 场里的一条：`{ id, value, order, source }` | — |
| **区域词** | 节点上十个闭合的物理位置（`title`/`in`/`out:*`/`on:*`/`over:*`） | 别自造表外的位置概念 |
| **区域** | 位置本身（几何，主题管） | — |
| **能力包** | 放进 `capability` 场的一组行为（hooks） | 不要每组件各写一份 |
| **目录** | 放进 `ui` 场的按名取用组件表 | 不是通用的组件注册，别滥用 |
| **糖** | `ctx.nodes` 这类对注册场的短写法 | 糖不占服务名 |
| **基础插件** | 提供核心服务、带 `core: true` 标识、不可热卸的那个插件（§决策 1） | 不是普通业务插件 |
| **core 标识** | 插件上声明 `core: true`（对象形态）或 `static core = true`（类形态）；被标记者拒绝动态卸载 | 不是"核心包"，是**单个插件**的属性 |

**以下是旧词，本文正文不再使用**（原样保留在此，便于读者对上旧代码/旧文档）：`容器`（= 注册场）、`注册表服务`（= 场，或指 `ctx.tools` 这类真服务）、`能力段`（= 注册场的糖，如 `ctx.nodes`）、`能力层`（= `canvas-data` 里造 `slots`/`settings` 的那一小段实现）。

---

## 十三、与既有文档的关系

- `docs/tmp/architecture-layer-audit/report.md` —— 本文的调查依据（现状与证据）。
- `docs/tmp/core-v2-service-ownership/research.md` §四方案 C —— 与本文"基础插件"是同一件事；当时做到"实现搬走、装配仍连着"，装配这一步一直没落，本文步骤 4 补上。
- `docs/design/ui-style-guide.md` —— 写任何浮层/面板 UI 前仍须先读它。
- `docs/STATUS.md` —— 落地时把进度写回这里。

---

## 十四、本文未做

- **零生产代码改动**（本文只是设计文档）。
- 未跑测试（无需）。索引查询用 `codegraph`，代码检索用 `rg`。
- 未核实 `deepseek-harness` 与本仓的对应关系（只引用了 `cordis-tutorial` 的第 3、7 两章）。
