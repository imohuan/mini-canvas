# 节点底部状态栏：可替换的注册式底栏 + 任务进度覆盖层

> 设计稿（brainstorming 产物）。执行计划见 `docs/superpowers/plans/2026-09-28-node-bottom-bar-registry.md`。

**目标：** 文本 / 图片 / 视频 / 音频四类节点的底部控制栏收敛成**一个**可替换的插件，
其它插件用「注册动作」的方式往里加按钮、下拉、执行逻辑；执行中的进度与状态
**落到节点 data**（刷新不丢），并在节点卡片上盖一层加载/进度覆盖。

**用户原话里的硬要求（逐条对应到设计）：**

1. 底栏做成一个插件，像主题一样可以被**替换**（插槽 + 注册场两种形式都要支持）。
2. 底栏里的 UI（下拉/输入框/按钮…）由**别的插件注册**进来，底栏自己不认识任何模型。
3. 点执行 = 跑注册方给的那个函数；同步直接返回，异步「创建任务 + 查任务」轮询进度。
4. 进度与状态信息**存进节点表**（与今天的 `data.runState` 同址），刷新页面不丢。
5. **不写任何兼容代码**：旧的三个底栏组件删掉，不做双轨。

---

## 一、现状（为什么现在做不到）

底栏是**每个节点插件自己写一份**：

| 节点 | 底栏组件 | 行数 |
|---|---|---|
| text | `plugin-node-text/src/TextGeneratePanel.vue` | 539 |
| image | `plugin-node-image/src/ImageGeneratePanel.vue` | 762 |
| video | `plugin-node-video/src/VideoClipPanel.vue` | 约 300 |

三份都在各自 `ctx.nodes.register({ segments: { 'out:bottom': … } })` 里挂成**基座段**。
基座段有一个关键性质：`nodeRegionStackEntries`（`packages/canvas-data/src/canvas/region.ts:130-183`）
永远把基座放在摞的最前面，之后才排 `attach`/`contribute` 进来的叠加条目。
**所以任何插件都无法用注册的方式顶掉别人的基座段** —— 这正是「底栏不能被替换」的根因。

进度与状态今天只活在组件里（`running` / `progress` 两个 `ref`），刷新即丢。
后台任务那条链（`packages/mcp-server/src/tasks/TaskManager.ts:108-113`）已经在写 `data.runState`，
但那条链是 AI 工具链后端，前端节点的底栏没接。

## 二、总体结构

新增一个插件包：**`packages/plugins/plugin-bottom-bar`**（`@mini-canvas/plugin-bottom-bar`，
插件名 `bottom-bar`）。它一人担三件事：

```
plugin-bottom-bar
├── nodeBar 服务      「注册一个动作」的收口（插件作者用的唯一入口）
├── nodeTask 服务     跑动作 + 把进度/状态写进节点 data + 刷新后恢复
├── BottomBarHost.vue 底栏宿主：读 themeRegistry.winner('bottomBar') 渲染当前赢家
├── NodeBottomBar.vue 默认底栏 UI（赢了才用它；换皮插件给更小 order 即顶掉）
└── NodeTaskOverlay.vue 卡片上的加载/进度覆盖层
```

三个节点插件（text / image / video）**删掉自己的 `out:bottom` 基座段**，改为
「往 `nodeBar` 注册动作」。BaseNode 一行不动：底栏仍然落在 `out:bottom` 区域，
只是改由 bottom-bar 插件用 `ctx.nodes.attach('*', { region: 'out:bottom', … })` 挂一份宿主。

```
BaseNode.out:bottom
        │  （区域摞里唯一一条：bottom-bar 挂的宿主）
        ▼
   BottomBarHost                      持有者：bottom-bar 插件
        │  读 themeRegistry.winner('bottomBar')
        ▼
   NodeBottomBar（默认皮）      ← 换底栏插件注册更小 order 即可整体顶掉
        │  读 ctx.get('nodeBar').list({ type: 本节点类型 })
        ▼
   动作 A / 动作 B / 动作 C     ← 各插件注册（含 text/image/video 自己）
```

**两层可替换性（用户明确要的两种形式）**

| 想替换什么 | 手段 | 语义 |
|---|---|---|
| 整个底栏的 UI 与内部逻辑 | `themeRegistry` 的 `bottomBar` 槽（order 最小者赢） | 与设置面板 `settingsPanel` 完全同构，已有机制 |
| 只往底栏里加一个按钮 | `ctx.nodeBar.register(...)`（同 id 替换） | 注册场语义，插件卸载自动摘除 |

**两条工程约定（照做才不会踩空）**

- **组件里取服务用 `ctx.get('nodeBar')`，不要直访 `ctx.nodeBar`**：服务解析 Proxy 只存在于
  插件作用域（`packages/kernel/src/Context.ts:1058`）；组件拿到的是根 `Context`，直访是 `undefined`。
  插件在 `apply(ctx)` 里写 `ctx.nodeBar.register(...)` 是对的。
- **底栏拿不到 `props.type`**：区域条目经 `RegionEntryHost` 只下发 `{ id, data }`，
  类型要 `ctx.get('doc').getNode(props.id)?.type` 取。

## 三、`nodeBar` 服务（作者入口）

```ts
ctx.nodeBar.register({
  id: 'video.generate:seedance',      // 唯一 id（用户说的「标识」）；同 id 重复注册 = 替换（热更）
  types: ['video'],                   // 给哪些节点类型用（省略 = 所有类型）
  title: '生成视频',                  // 按钮文字
  icon: '<svg …>',                    // 可选图标（与节点类型 icon 同一写法）
  fields: [                           // 可视化配置：复用内核 ToolParamDef 词表，不新造
    { key: 'ratio', label: '比例', type: 'select', options: [...], default: '16:9' },
  ],
  needsPrompt: true,                  // 要不要底栏那个大输入框（默认 false）
  panel: VideoTimeline,               // 可选：本动作专属的面板（视频剪辑时间轴这类）
  apply: 'applier',                   // 结果交给同 kind 写入器（默认）；'self' = 本动作自己写好了
  run(input, runCtx) {                // 与内核工具同一个契约
    return { ok: true, urls: [...] }              // 同步
    // 或 return () => ({ status:'running', progress, message })   // 异步：内核已有的轮询形态
  },
  resume(taskId) { return () => ({ status: 'running' }) },        // 可选：刷新后接着查
})
```

要点：

- **`run` 的返回契约直接复用内核 `ToolOutcome`**（`ToolResult | ToolPollFn`）与
  `ToolProgress` / `ToolParamDef` / `ToolTemplate`（`packages/kernel/src/toolRegistry.ts`）。
  不新造「动作参数」词表 —— 一个词表两处用，底栏与工具面板长得一样是因为它们本来就是同一件事。
- `fields` 由默认底栏交给 **`useUiComponent('toolParamField')`** 渲染（主题可替换目录），
  所以加一个下拉 = 注册方多写一个字段，底栏与内核零改动。
- 结果回写不走动作本身（除非它声明 `apply: 'self'`）：默认交给**同 kind 的写入器**（见 `五）。
- `info(data)` 给出本节点上的只读读数（文本节点「12 字 · 3 行」）；`onSelect/onDeselect`
  让动作与会话态联动（视频剪辑面板开合）。
- **`nodeBar` 是插件提供的服务，节点插件不硬 `inject` 它**：取得到就注册，取不到等
  `ctx:plugin-installed` 再注册；没装 bottom-bar 的宿主里节点插件照常工作。

### 从 `ctx.tools` 自动生成动作

今天图片/文本节点的生成能力来自 `ctx.tools`（工具插件注册）。默认底栏会把
`ctx.tools.list({ produces: kindOf(nodeType) })` 的每个工具**自动当一条动作**列出来
（下拉 = 工具、`fields` = 工具声明的 `params`、模板下拉 = 工具声明的 `templates`）。
于是「加一个模型 = 装一个工具插件」这条既有承诺不变，而 UI 从两份实现变成一份实现。

## 四、`nodeTask` 服务（执行 + 进度 + 落盘）

```ts
ctx.nodeTask.run(nodeId, actionId, { values, prompt })   // 起一次任务
ctx.nodeTask.state(nodeId)                               // 读当前状态
ctx.nodeTask.cancel(nodeId)                              // 取消（AbortSignal）
ctx.nodeTask.restoreAll()                                // 刷新后把 running 的节点接回来
```

### 进度写盘（唯一口径）

**每一帧都写节点**，走新 API `doc.updateNodeRuntime`（落盘但**不进撤销栈**）。

| 时刻 | 写什么 | 走哪条 API | 进撤销栈吗 |
|---|---|---|---|
| 提交那一刻 | `{ status:'running', progress:0, actionId, startedAt }` | `updateNodeRuntime` | 否 |
| 每次轮询有进展 | `{ status:'running', progress, message, taskId, actionId }` | `updateNodeRuntime` | 否 |
| 终态 | `{ status:'done' / 'error', … }` | `updateNodeRuntime` | 否 |
| 产物落到节点（图/文/视频地址） | `data` 真字段 | `doc.updateNode`（**作品写入，进历史**） | 是 |

为什么每帧都写盘（而不是「终态才写」）：用户明确要求「进度与状态要保存到本地，
不然刷新一下全完蛋」。如果 running 只在内存，刷新时 localStorage 里根本没有 running，
「续查 / 判中断」两条分支永远命中不了，进度信息还是丢了。

代价：`scheduleCommit()`（`graphDocument.ts:405-417`）每次都会全图 `snapshot()` 深拷贝并触发
`save.set(GRAPH_KEY, …)`。所以中间帧做 200ms 节流（**节流窗口内不写，不论进度是否变**），
终态不节流、必写。

`data.runState` 形状与 mcp-server 既有的一模一样（**有意撞名**：同一个含义用同一个键，
云端后台写的进度前端能直接显示）：

```ts
data.runState = {
  status: 'running' | 'done' | 'error',
  progress?: number,          // 0-100；外部只给阶段时省略
  message?: string,
  taskId?: string,            // 异步任务 id（刷新后靠它续查）
  actionId?: string,          // 谁提交的
  startedAt?: number,
}
```

### 刷新后恢复（谁调用 `restoreAll`）

`restoreAll()` 由 bottom-bar 插件自己的 `apply` 在 **`ctx:ready`**（`Context.start()` 末尾的内核事件）
里调一次 —— 那时所有插件已激活、动作都注册完，才谈得上「这个 taskId 还找不找得到人续查」。

- `done` / `error` → 直接读回显示（覆盖层不转圈，底栏显示结果或错误）；
- `running` 且动作声明了 `resume` → **续查**（拿 `taskId` 从头续）；
- `running` 但续不了（动作没声明 `resume`、页面关了、后台重启）→
  标成 `error: '刷新后任务已中断'`，不留悬挂转圈。

## 五、结果写入器（`applier`）

动作默认只产出结果，写节点由**同 kind 的写入器**做：

```ts
ctx.nodeBar.registerApplier('image', (nodeId, result) => { /* 写 imageUrl + 尺寸 */ })
```

image 节点把今天 `imageRun.writeGeneratedImage` 的那套（量尺寸 → 一次 patch 写完 →
清旧描述字段）搬进来；text 节点写 `data.text`；video 节点写 `data.videoUrl`。
**一个 kind 只允许一个写入器**（同 kind 重复注册抛错），避免「谁写谁」分不清。
声明 `apply: 'self'` 的即时动作（旋转/下载/复制/删除）不走写入器 —— 它们自己已经写好了。

## 六、加载/进度覆盖层

`NodeTaskOverlay.vue` 由 bottom-bar 插件经
`ctx.nodes.attach('*', { region: 'over:inset', component: NodeTaskOverlay, id: 'bottom-bar/overlay' })` 挂上。

- `over:inset` 就是设计文档 `五 里「卡片内部覆盖层」的正式区域词，**不需要动 BaseNode**。
- 组件自己 `v-if`：只在本节点 `runState.status === 'running'` 时出现。
- 内容：半透明遮罩 + 转圈 + 进度百分比（有就画进度条，没有就来回走）+ 阶段文案 + 取消。
- 视觉照 `docs/design/ui-style-guide.md`（遮罩材质、token、`prefers-reduced-motion` 降级）。

**同层顺序（要说准，别记错）**：`BaseNode` 对 `over:inset` 是**一次 v-for**
（`BaseNode.vue:919-925`），DOM 顺序 = 「基座条目在前、注册场条目按 order 在后」；`order`
只在**同一条写路径内**排序，跨不过基座。结论：**图片/视频的编辑浮层（基座）恒在下、
覆盖层（注册场）恒在上**。若第三方插件也往 `over:inset` attach 条目，它会盖住覆盖层 ——
已知取舍。

## 七、mock 后台（用户要求先看到一个效果）

新增 `packages/plugins/plugin-mock-task-backend`：

- 一个内存假后台，实现用户描述的接口形状：**创建任务**（同步/异步两种）+ **查询任务**；
- 注册两条动作到 `ctx.nodeBar`：
  - `mock-task:sync`（图片）：等 1.2s 直接出结果 —— 验证同步路径；
  - `mock-task:async`（图片）：返回轮询函数，进度 0→100 分 10 帧 —— 验证异步路径 + 覆盖层进度；
- 装进 `packages/ui/src/assembly.ts`，起 `pnpm -C packages/ui dev` 就能看到：
  选中图片节点 → 底栏出现两条动作 → 点执行 → 卡片上出现覆盖层与进度 → 完成后覆盖层消失。
  （注意：mock 动作经 image 写入器写 `imageUrl`，点了它当前图会被换成 mock 产物 —— 预期行为。）

## 八、迁移清单（不设兼容）

**删除：**

- `plugin-node-text/src/TextGeneratePanel.vue` + `textPanelSource.ts` + 两个面板/来源测试
- `plugin-node-image/src/ImageGeneratePanel.vue` + `panelSource.ts` + 两个面板/来源测试
- `plugin-node-image/src/imageRun.ts` 的 `runImageGeneration`（连同它 import 的 `buildToolInput`）
- `plugin-node-video/src/VideoClipPanel.vue` 的 `out:bottom` 段注册（组件本体保留，改为经
  `nodeBar.register({ panel })` 使用，显隐门从会话态改成 `visible = selected`）

**保留并上移：**

- `panelSource.ts` / `textPanelSource.ts` 里的上游素材收集、@ 引用解析、`buildToolInput`
  → 合并成 bottom-bar 的 `src/panelSource.ts`（四个类型都要用，不是某个类型的私货），
  纯逻辑测试一并搬。

**测试同步：** `packages/ui/src/__tests__/nodePluginsAssembly.test.ts` 的 `EXPECTED`
（text/image/video 不再有 `out:bottom` 基座段）、`entrypoint.test.ts` 的插件条数、
`packages/ui/e2e/canvas-e2e.mjs` 追加底栏/覆盖层/落盘/刷新断言。

## 九、验收标准

1. 三个节点插件里不再有任何 `out:bottom` 基座段；底栏只有一份实现。
2. 另一个插件 `themeRegistry.add('bottomBar', MyBar, { order: -1 })` 后界面上的底栏换成 MyBar。
3. `ctx.nodeBar.register({ id, types:['image'], fields:[…], run })` 之后图片节点底栏多出该动作，
   卸载插件后消失；同 id 再注册 = 替换而不是变成两条。
4. 跑一次异步动作：卡片上出现覆盖层与百分比；终态后 localStorage 里该节点留有
   `{ status:'done', actionId, taskId }`；撤销栈条数不随进度帧增长。
5. 刷新页面后覆盖层不转圈（能续查就续查，续不了就明确报中断）。
6. 全包测试与 typecheck 全绿。

## 十、已知取舍

- 中间进度帧每帧落盘、但进撤销栈为 0；落盘频率用 200ms 节流压住。
- `over:inset` 会把覆盖层与图片/视频的编辑浮层放进同一层容器：基座恒在下、覆盖层恒在上；
  编辑态下不会同时有 running 任务，冲突面很小。
- `nodeBar` 是插件服务：没装 bottom-bar 的宿主里底栏不存在（这是设计意图）；
  节点插件不硬依赖它，因此不会把别人的宿主拖成 PENDING。
- 音频节点类型目前不存在；`nodeBar.register({ types:['audio'] })` 在音频节点插件出现时
  直接可用，底栏无需改动。
