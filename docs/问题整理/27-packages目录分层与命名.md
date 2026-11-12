# 27 · packages目录分层与命名

- 状态：待确认
- 负责人：未领取
- 完成时间：—

## 你的原话

> 我需要你优化我的 项目结构 ，在 packages/ 里面这些文件夹 库 不太合理， 名称也不太合理
>
> 就比如你的ui-kit-shadcn 应该放在插件库里面 但是他属于核心插件什么的， 我也不知道该如何区分 有一些库 是一些工具库，  怎么说那
>
> 你帮我分析分析

## 要解决的问题

让 `packages/` 一眼能看出四类东西：引擎、库、插件、应用。名字要说清它是什么，不再把“组件库、契约、工具函数、插件、应用”混在同一层。

## 范围与位置

- 页面：无（仓库结构）
- 参考代码：`packages/` 顶层 13 个目录、`packages/plugins/` 下 35 个目录、`packages/ui-kit-shadcn/package.json`、`packages/bar-contract/src/index.ts`、`packages/canvas-base/src/index.ts`、`packages/vue-render/src/index.ts`、`packages/theme-contract/src/index.ts`、`pnpm-workspace.yaml`、`packages/cloud-server/scripts/plugin-assets.mjs`、`packages/cloud-server/scripts/build-assets-parallel.mjs`、`packages/docs/.vitepress/data/plugins.data.ts`
- 相关资源：无
- 关联问题：24（插件目录与安装流水线）、18（项目页插件面板与上下文分层）

## 现在 vs 期望

| | 现在 | 期望 |
| --- | --- | --- |
| 顶层 | 引擎、SDK、组件库、应用、服务端、文档、插件都在 `packages/` 同一层 | 先按 `engine` / `libs` / `plugins` / `apps` 分四层 |
| 插件目录 | 35 个目录平铺，核心主题、节点、工具、Agent、开发工具、示例、兼容薄片混在一起 | 每个插件有 `plume.kind`，能按类筛选；不参与发布的薄片不叫 `plugin-*` |
| 组件库 | `ui-kit-shadcn` 和插件放同一层，容易被当成插件 | `ui-kit` 放进 `libs/`，明确是设计系统库 |
| 契约包 | `bar-contract` 和 `theme-contract` 各是一个独立包 | 两个包都删掉；内容合并进对应插件或引擎，通过插件上下文取用 |
| 作者入口 | `canvas-base` 听起来像画布基础层 | 改叫 `plugin-sdk`，明确是给插件作者用的薄入口 |
| 渲染底座 | `vue-render` 与 `canvas-render` 名字太近 | 保留职责说明，或改叫 `render-kit` |
| 编辑器 | `prosemirror-editor-bundle` 没有 scope | `@plume-canvas/editor` |
| 应用 | `ui` / `cloud-server` / `docs` 在 `packages/` 里 | 移到 `apps/web` / `apps/server` / `apps/docs` |

## 问题原因

- 状态：已确认
- 复现步骤：打开 `packages/` 顶层；再打开 `packages/plugins/`；再分别读 `ui-kit-shadcn`、`bar-contract`、`canvas-base`、`vue-render` 的 `package.json` 和 `src/index.ts`。
- 证据：`packages/` 顶层 13 个目录里，既有 `kernel`（纯内核）、`ui-kit-shadcn`（设计系统）、`ui`（成品应用），也有 `docs`（文档站）和 `cloud-server`（后台），它们不是同一种东西却放在同一层；`packages/plugins/` 有 35 个目录，其中 `plugin-auto-save` 与 `plugin-history` 没有 `plume` 字段、没有 `build` 脚本，不会被插件清单收录；`bar-contract/src/index.ts` 同时导出底栏动作和 `apiUrl` / `normalizeApiBase`，`plugin-style-library`、`plugin-showcase` 只是为了拿 URL 工具却要依赖“底栏契约”包；`ui-kit-shadcn/package.json` 没有 `plume` 字段，不参与插件安装，是 `theme-contract` 和主题插件的上游依赖；`canvas-base/src/index.ts` 自述是“插件作者的友好收口薄层”；`vue-render/src/index.ts` 自述是“通用 Vue 渲染底座（不碰画布）”；`theme-contract` 还包含 `themeDefaults`、`canvasConfig`、`themeBridge`、`edgeGeometry` 等运行时内容；`prosemirror-editor-bundle` 的包名没有 `@plume-canvas/` 前缀，版本是 `1.0.0`。
- 根因：早期按“先能跑”堆包，没有给包定角色；目录名又同时承担“包名、插件名、构建入口”三种身份，所以越加越难分。

## 修改方案

先给判断标准，再给目标结构，最后给分阶段做法。本阶段只改目录和名字，不改插件行为。

### 1. 先分清四类东西

| 类别 | 判断标准 | 例子 |
| --- | --- | --- |
| 引擎 | 提供运行时底座，不负责启动产品，不能被插件装卸 | `kernel`、`canvas-data`、`canvas-render`、`vue-render` |
| 库 | 只被 import，提供类型、函数、组件或契约；没有 `plume.pluginName` | `plugin-sdk`、`ui-kit`、`editor` |
| 插件 | 有 `plume.pluginName`，能在运行时装卸，会往内核注册节点/槽/命令/服务 | `plugin-node-text`、`plugin-theme-canvas`、`plugin-agent` |
| 应用 | 负责启动一个可运行的产品或服务 | `apps/web`、`apps/server`、`apps/docs` |

一句话：能卸掉、卸掉后画布还开着 → 插件；只能被 import → 库；负责把产品跑起来 → 应用。

### 2. 推荐的目标结构

下面这棵树就是“改完之后长什么样”。括号里写的是它从哪儿来、负责什么。

```text
mini-canvas/
├─ apps/                               # 能启动的产品都放这里
│  ├─ web/                             # 原 packages/ui：成品网页，pnpm dev 打开画布
│  ├─ server/                          # 原 packages/cloud-server：后台，存画布和资源
│  └─ docs/                            # 原 packages/docs：文档站，端口 5290
│
├─ packages/                           # 写代码时反复使用的包
│  ├─ engine/                          # 引擎：画布的发动机，不负责启动产品
│  │  ├─ kernel/                       # 纯插件内核：装载、依赖、事件、作用域回收
│  │  ├─ canvas-data/                  # 画布数据：节点、连线、保存、撤销、选中
│  │  ├─ canvas-render/                # 画布渲染：VueFlow 宿主、视口、节点布局
│  │  └─ vue-render/                   # 通用 Vue 渲染底座：槽位、设置外壳、组件目录
│  │
│  ├─ libs/                            # 库：只会被 import，没有 plume.pluginName
│  │  ├─ plugin-sdk/                   # 原 canvas-base：插件作者的统一入口
│  │  ├─ ui-kit/                       # 原 ui-kit-shadcn：按钮、下拉、弹窗等零件
│  │  ├─ editor/                       # 原 prosemirror-editor-bundle：富文本编辑器
│  │
│  └─ plugins/                         # 插件：能装能卸，卸掉画布还开着
│     ├─ plugin-theme-canvas/          # 核心：节点壳、连线、背景（红线组件在这）
│     ├─ plugin-theme-components/      # 核心：通用组件、设置面板、外观变量
│     ├─ plugin-bottom-bar/            # 核心：节点底栏
│     ├─ plugin-cloud-client/          # 核心：连后台；首启必须最先装
│     ├─ plugin-manager/               # 核心：设置里的“插件”页
│     ├─ plugin-node-text/             # 节点：文本
│     ├─ plugin-node-image/            # 节点：图片
│     ├─ plugin-node-video/            # 节点：视频
│     ├─ plugin-node-audio/            # 节点：音频
│     ├─ plugin-node-3d-preview/       # 节点：3D 预览
│     ├─ plugin-node-image-compare/    # 节点：图片对比
│     ├─ plugin-node-ui/               # 节点：AI 可视化节点
│     ├─ plugin-node-rotate/           # 节点：旋转与镜像
│     ├─ plugin-image-grid-split/      # 节点：宫格切分
│     ├─ plugin-align-arrange/         # 工具：对齐排列
│     ├─ plugin-align-guide/           # 工具：参考线
│     ├─ plugin-auto-layout/           # 工具：自动布局
│     ├─ plugin-clipboard/             # 工具：复制粘贴
│     ├─ plugin-context-menu/          # 工具：右键菜单
│     ├─ plugin-edge-cutting/          # 工具：连线切割
│     ├─ plugin-file-drop/             # 工具：文件拖入
│     ├─ plugin-group/                 # 工具：分组
│     ├─ plugin-multi-select/          # 工具：多选
│     ├─ plugin-mini-map/              # 工具：小地图
│     ├─ plugin-node-find/             # 工具：节点搜索
│     ├─ plugin-canvas-export/         # 工具：导出图片
│     ├─ plugin-cursor-effect/         # 工具：光标与点击特效
│     ├─ plugin-shortcut-manager/      # 工具：快捷键帮助与设置
│     ├─ plugin-style-library/         # 内容：素材库、风格库
│     ├─ plugin-agent/                 # Agent：对话、工具调用、后台半
│     ├─ plugin-auto-save/             # 可选：定时兜底保存（需补 plume 元信息才进清单）
│     ├─ plugin-history/               # 可选：旧版撤销/重做命令名
│     ├─ plugin-demo-kit/              # 示例：插件演练场（可安装，不冷启动）
│     ├─ plugin-showcase/              # 示例：在线测试台与在线文档
│     └─ plugin-hot-reload/            # 开发：热重载，不随发布包发出
```

一个包里面长这样（以节点插件为例）：

```text
plugin-node-text/
├─ package.json          # 包名、依赖、plume 元信息（pluginName / kind / builtin）
├─ tsconfig.json         # 类型检查配置
├─ vite.config.ts        # 构建成可加载的插件产物
└─ src/
   ├─ index.ts           # 出口：导出插件模块
   ├─ nodeTextPlugin.ts  # 插件主体：name / inject / apply
   ├─ TextContent.vue    # 节点里显示的内容
   └─ __tests__/         # 这个插件自己的测试
```

每层的判断标准：

- `apps/` 里的包都能启动，改它们会直接影响用户看到什么。
- `packages/engine/` 是画布的发动机，插件只能依赖它，它不能反过来依赖插件。
- `packages/libs/` 只提供零件和说明书，拿掉它编译不过，但画布不会因为卸载而少一块。
- `packages/plugins/` 里的东西都能装卸；装上一个多一块能力，卸掉画布还开着。

插件目录先保持平铺，是因为现在有 6 处代码按 `packages/plugins/*` 一层扫描：插件构建、插件清单、文档数据加载、UI 开发清单、插件测试、零引用检查。先把“分类”放进 `plume.kind`，不用同时改 6 个扫描器；等分类稳定后，再决定要不要物理分组。

`api-base` 没有出现在树里：它只有 3 个纯函数，删掉 `bar-contract` 后搬进 `plugin-sdk`。不值得为 3 个函数单开一个包。

### 2.1 删除 `bar-contract`：底栏动作改走服务 + 注册场

现状：`plugin-node-text`、`plugin-node-video`、`plugin-bottom-bar` 都直接 import `@plume-canvas/bar-contract` 的 `registerBarAction` / `registerBarApplier` / `publishToolActions`。这正是插件之间“为了共享一行函数而互相依赖”的典型。

`plugin-bottom-bar` 已经有现成替代：`NodeBarService`（服务名 `nodeBar`），方法签名就是接收调用方 `scope`，把条目落在调用方作用域里：

```ts
// 现在（跨包 import）
import { registerBarAction, registerBarApplier } from '@plume-canvas/bar-contract'
registerBarAction(ctx, action)

// 改后（按服务名协作，插件包之间零 import）
const bar = ctx.get('nodeBar')
bar.register(ctx, action)
bar.registerApplier(ctx, 'image', applyFn)
bar.publishTools(ctx, { types: ['image'], produces: 'image' })
```

合并步骤：

1. 把 `bar-contract/src/types.ts`（`BarAction` / `BarApplier` / `BarRunInput` / `BarRunContext`）搬进 `plugin-bottom-bar/src/types/`，并从 `plugin-bottom-bar` 出口导出类型。
2. 把 `bar-contract/src/registry.ts` 的两个注册函数变成 `plugin-bottom-bar` 的内部实现；对外只保留 `nodeBar` 服务方法。
3. 把 `bar-contract/src/toolActions.ts` 搬进 `plugin-bottom-bar`（它本来就标着“已迁到 bar-contract”，等于搬回去）。
4. 把 `bar-contract/src/apiBase.ts` 的 3 个纯函数搬进 `plugin-sdk`（插件都能 import 的公共薄层），`plugin-style-library` / `plugin-showcase` 改从 `plugin-sdk` 取。
5. 删除 `packages/bar-contract`，同步删掉各 `package.json` 的 workspace 依赖与 `vite.config.ts` 的 external 映射。

`inject: ['nodeBar']` 要写进用到它的插件；内核会等底栏插件就位再启动这些插件。没装底栏时，这些动作本来也没有地方显示，行为一致。

### 2.2 删除 `theme-contract`：按三块拆，不能整包塞进一个插件

这个包比 `bar-contract` 难，因为它同时装着三种东西：

| 内容 | 现在谁用 | 合并到哪里 | 为什么不能“塞进插件” |
| --- | --- | --- | --- |
| 纯函数：`buildEdgePath`、`applyThemeBridge`、`createNotifyService`、`resolveMultiRadio`、`nodeLoadingTier` | 两个主题插件、`ui` | 按用途搬进对应的使用方；跨插件共用的搬进 `canvas-render` | 插件之间不能互相 import（有测试钉着） |
| 配置默认值：`DEFAULT_THEME_EDGE`、`DEFAULT_THEME_HANDLE`、`DEFAULT_THEME_SNAP_ZONE`、`DEFAULT_THEME_APPEARANCE` | `ui` 的 `createUiState.ts`、两个主题插件 | `canvas-render`（它已经有 `DEFAULT_EDGE_VISUAL` 等同类默认值） | `ui` 在插件安装前就要渲染外壳，不能等插件给默认值 |
| 类型与菜单表：`navIcon`、`SettingsNavigation` 相关 | 两个主题插件 | `plugin-theme-components` | 只有它在用 |

关键判断：**界面启动需要的默认值，不能靠“已安装的主题插件”提供。** 现在 `apps/web` 在装任何插件之前就要建 `cfg.edge` / `cfg.handle` / `cfg.snapZone` / `cfg.debug`（`createUiState.ts:9`），并传给 `CanvasHost`。如果改从插件服务取，插件没装时就是空白或 undefined，画布直接坏。

同理，`ui` 还需要 `EDGE_SETTING_KEYS` 这类“哪些设置键归到哪一组”的表来分发 `settings.onChange`。这张表也必须能在插件缺席时工作。

所以 `theme-contract` 的正确合并方向是“下沉到引擎 + 上游插件”，不是“变成插件上下文里的数据”。插件内部私有、只服务自己的那部分（设置菜单导航、主题工作台）直接并进 `plugin-theme-components`。

合并后，主题两半仍然互不 import，因为共享的类型和默认值都住在 `canvas-render` 里，两边都依赖引擎即可。

实际落地顺序建议：

1. 先把 `DEFAULT_THEME_*` 与 `*_SETTING_KEYS` 从 `theme-contract` 搬进 `canvas-render`，直接引用 `DEFAULT_EDGE_VISUAL` 那一组已有默认值，不留第二份。
2. 把 `buildEdgePath` 搬进 `canvas-render`（边几何本来就是渲染的事）；`plugin-theme-canvas` 的 `CustomEdge` / `ConnectionLine` 从 `canvas-render` 取。
3. 把 `applyThemeBridge` / `findFont` 这类“组件库桥接”搬进 `plugin-theme-components` 或 `ui-kit`；只有组件半边用，画布半边不需要。
4. 把 `createNotifyService` 并进 `plugin-theme-components`（它现在就是在那里 `provide` 的）；`canvas-render` 里那份同名实现只保留一份，两边以 `notify` 服务名协作。
5. 把 `navIcon` 场与设置导航类型搬进 `plugin-theme-components`。
6. 删除 `packages/theme-contract`，同步删 `HOST_GLOBALS` 里的 `PlumeThemeContract`、`ui/vite.config.ts` 的 `exclude`、各包依赖。

### 2.3 用上下文替代的条件

`ctx` 能替代“包”，但只替代这三类：

| 原来靠包共享的东西 | 能否改走 `ctx` | 怎么走 |
| --- | --- | --- |
| 注册函数（往注册场写条目） | 能 | 服务方法收调用方 `scope`，如 `nodeBar.register(ctx, action)` |
| 运行时共享数据（通知服务、设置值） | 能 | 插件 `ctx.provide` / `ctx.get` |
| 共享类型（`interface`） | 不能 | 类型在编译后就消失，只能放引擎或 `plugin-sdk` |
| 启动默认值（界面初始值） | 不能 | 必须在插件装载前就存在，放引擎 |

一句话：`ctx` 管“运行时要一起干活的东西”，管不了“编译时的类型”和“启动前的默认值”。

### 3. 插件按 `plume.kind` 分类

建议值：

| kind | 含义 | 例子 |
| --- | --- | --- |
| `core` | 缺了主流程明显坏掉，随应用冷启动 | `theme-canvas`、`theme-components`、`bottom-bar`、`cloud-client` |
| `node` | 提供一种节点类型或节点操作 | `node-text`、`node-image`、`node-video`、`image-grid-split` |
| `tool` | 画布工具或交互增强 | `align-arrange`、`auto-layout`、`clipboard`、`context-menu`、`mini-map` |
| `content` | 内容/素材库 | `style-library` |
| `agent` | Agent 与模型能力 | `plugin-agent` |
| `dev` | 只给开发用，不随发布包发出 | `hot-reload` |
| `example` | 示例、演示、可安装的样板 | `demo-kit`、`showcase` |
| `optional` | 可选装插件，不随冷启动 | `auto-save`、`history` |

`core` 只描述“缺了会坏”，不等于“不可卸载”。真正不能热卸的插件仍由内核的 `core: true` 标记决定；`plume.kind` 只用于分类和构建清单，不改变运行行为。

### 4. 具体改名建议

| 现在 | 建议 | 理由 | 改动量 |
| --- | --- | --- | --- |
| `packages/ui` | `apps/web` | 它是成品应用，不是库 | 路径引用多，但包名不变 |
| `packages/cloud-server` | `apps/server` | 它是可启动的后台 | 路径引用中等 |
| `packages/docs` | `apps/docs` | 它是可启动的文档站 | 路径引用少 |
| `packages/ui-kit-shadcn` | `packages/libs/ui-kit`，包名 `@plume-canvas/ui-kit` | 设计系统库，不是插件；“shadcn”是实现细节 | 77 处引用 |
| `packages/bar-contract` | **删除**；底栏动作与类型合并进 `plugin-bottom-bar` | 跨插件注册改走 `ctx.registryOf('node/bar')`，调用方不再 import 另一个插件的包 | 24 处引用 |
| `packages/theme-contract` | **删除**；三块分别合并进 `plugin-theme-canvas`、`plugin-theme-components`、`canvas-render` | 共享类型与默认值搬进引擎；插件内部私有的搬进 `plugin-theme-components` | 42 处引用 |
| `packages/canvas-base` | `packages/libs/plugin-sdk`，包名 `@plume-canvas/plugin-sdk` | 它是插件作者入口，不是画布基础层 | 277 处引用，最后做 |
| `packages/vue-render` | 保留，或改 `packages/engine/render-kit` | 名字和 `canvas-render` 太近 | 39 处引用 |
| `packages/prosemirror-editor-bundle` | `packages/libs/editor`，包名 `@plume-canvas/editor` | 统一 scope，名字更短 | 约 20 处引用 |
| `plugin-auto-save` / `plugin-history` | 留在 `packages/plugins/`，补 `plume` 元信息 | 它们本来就是插件（`name / inject / apply`），只是缺登记；搬去 `libs` 就丢了“可选装”的身份 | 少量测试引用 |

`packages/kernel`、`packages/canvas-data`、`packages/canvas-render` 的名字已经够清楚，建议保留。

### 5. 分阶段做，别一次搬完

**第 1 步：只搬目录，不改包名（低风险）**

- 建 `packages/engine/`、`packages/libs/`、`apps/`。
- 把 `kernel`、`canvas-data`、`canvas-render`、`vue-render` 移到 `packages/engine/`。
- 把 `canvas-base`、`ui-kit-shadcn`、`prosemirror-editor-bundle` 移到 `packages/libs/`；`theme-contract`、`bar-contract` 先原地不动，等第 2 步合并后直接删除，不搬目录。
- 把 `ui`、`cloud-server`、`docs` 移到 `apps/`。
- 更新 `pnpm-workspace.yaml`、`packages/cloud-server/scripts/build-assets-parallel.mjs` 的 `WORKSPACE_ROOTS`、各测试里的扫描目录、文档里的路径。
- 包名和 import 一律不动。这样 900 多处 `@plume-canvas/...` 引用不用改。

**第 2 步：删除两个契约包**

- 先删 `bar-contract`：底栏动作类型与两个注册函数搬进 `plugin-bottom-bar`，并对其它插件暴露成 `ctx` 服务。
- 再删 `theme-contract`：按 2.2 的三块拆分处理。
- `apiBase.ts` 的 3 个纯函数先搬进 `plugin-sdk`（插件都能 import 它），不让风格库反向依赖底栏插件。
- 把 `ui-kit-shadcn` 改名为 `ui-kit`，包名 `@plume-canvas/ui-kit`。
- 把 `prosemirror-editor-bundle` 改名为 `@plume-canvas/editor`。
- 同步更新 import、`vite.config.ts` 的 `optimizeDeps`、`HOST_EXTERNALS`、文档。

**第 3 步：给插件加 `plume.kind`**

- 给 33 个有 `plume` 元信息的插件补 `kind`。
- 给 `plugin-auto-save`、`plugin-history` 补 `plume.pluginName` 与 `plume.kind: optional`，让它们能被清单和文档识别；它们继续留在插件目录。
- 生成 `packages/plugins/README.md` 的分类表，后面新增插件照着填。

**第 4 步：高改动量改名（可选，最后做）**

- `canvas-base` → `plugin-sdk`（277 处）。
- `vue-render` → `render-kit`（39 处）。
- 这两步只改名字，不改行为；做完跑全量类型检查和测试。

**第 5 步（可选）：插件物理分组**

只有确认 6 个扫描器都能递归后，再把 `packages/plugins/` 分成 `core/`、`nodes/`、`tools/`、`examples/`。不建议和第 1 步一起做，否则出问题时很难判断是“目录搬错”还是“扫描器没改”。

## 验收标准

- [ ] `packages/` 顶层只剩 `engine/`、`libs/`、`plugins/` 三类，应用在 `apps/`
- [ ] `ui-kit` 不再出现在 `plugins/` 下，也不会被插件清单扫描到
- [ ] `bar-contract` 已删除；底栏动作改由 `ctx.get('nodeBar')` 注册
- [ ] `theme-contract` 已删除；`ui` 不再 import 任何插件包
- [ ] `plugin-auto-save` / `plugin-history` 有 `plume.pluginName` 与 `plume.kind`，留在插件目录
- [ ] 每个插件都有 `plume.kind`，`packages/plugins/README.md` 的分类表与 `package.json` 一致
- [ ] `pnpm install` 成功，workspace 能识别全部包
- [ ] `packages/engine/*`、`packages/libs/*`、`apps/web`、`apps/server` 的类型检查通过
- [ ] `apps/web` 的 `pnpm build` 产物里仍然没有插件代码
- [ ] `apps/server` 能构建插件资源并启动，Chrome 打开画布能看到节点和主题
- [ ] 全仓搜索旧路径为 0 命中（`backup/` 与历史文档除外）

## 不能动

- 不改 `backup/` 与根目录 `src/`（v1）
- 不改插件运行行为、插件名、节点类型名、服务名
- 不改 `plugin-theme-canvas` 的六个红线组件
- 不在同一阶段同时做“目录搬迁 + 包名改名 + 插件物理分组”
- 不改仓库根目录名 `D:\Code\Git\mini-canvas`

## 假设与待确认

- 假设 1：`ui-kit-shadcn` 不是插件，而是设计系统库；它不应该放进 `packages/plugins/`。
- 假设 2：`bar-contract` 已确认删除；`apiUrl` / `normalizeApiBase` 搬进 `plugin-sdk`，不单独成包。
- 假设 3：`plugin-auto-save` / `plugin-history` 本来就是插件，只是缺 `plume` 元信息，所以留在插件目录。
- 待确认 1：目标结构是否按 `engine` / `libs` / `plugins` / `apps` 四层？还是只想先改名字、不搬目录？
- 待确认 2：插件目录要不要物理分组？如果分，需要先改 6 个扫描器；如果不分，就用 `plume.kind` 分类。
- 待确认 3：`canvas-base` → `plugin-sdk`、`vue-render` → `render-kit` 这两个高改动量改名，是否这次一起做？
- 待确认 4：`plugin-auto-save` / `plugin-history` 要不要随发布包发出？如果要，给它们补 `build` 脚本和 `plume.web.entry`。
- 待确认 5：`theme-contract` 里 `DEFAULT_THEME_*` 这组启动默认值，放回 `canvas-render` 是否接受？这是保留“插件没装也能开机”的唯一办法。
- 待确认 6：`nodeBar` / `nodeTask` 改成 `inject: ['nodeBar']` 硬依赖后，没装底栏插件的自定义宿主会缺动作入口；是否接受“底栏成为节点动作的必要条件”？

## 执行指令

先按第 1 步只搬目录、不改包名；跑 `pnpm install`、各包类型检查和测试；确认画布能启动后，再做第 2 步的包名改名。每一步单独提交、单独验证。不要一次同时改目录、包名和插件分组。

## 图片

本问题没有图片。

## 执行记录

- 改动文件：`docs/问题整理/27-packages目录分层与命名.md`、`docs/问题整理/README.md`
- 验证命令与结果：`python -X utf8 .codex/skills/issue-briefing/scripts/check_issue_docs.py "docs/问题整理/27-packages目录分层与命名.md"` 通过
- 完成时间：—
