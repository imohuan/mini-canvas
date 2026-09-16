# mini-canvas 项目指挥入口（每次开工先读这里）

> **我是项目的"当前该干什么"入口。任何 AI / 会话在本项目干活前，先读本文件确认进度与下一步，再读 `docs/plan/canvas-core-v2-runbook.md` 拿执行剧本。**

## 当前主线（2026-09-14 更新）：三层包结构 —— kernel / canvas-data / canvas-render

`packages/canvas-core-v2` **已删除**（实现与测试分别迁入 kernel 与 canvas-data）。

```
@mini-canvas/kernel         纯插件框架 + 通用能力（tools / command / iconKind / SettingsStore / SlotRegistry），零画布概念、零 Vue
@mini-canvas/canvas-data    数据层 + 画布语义层（nodeStore/edgeStore/graph/save/history/selection + canvas/ 下节点主题注册表、能力段、连接校验、菜单聚合、建节点、画布 Context）
@mini-canvas/canvas-render  渲染层（VueFlow/DOM/令牌 + nodeLayout/viewport）
packages/plugins/*          插件库（22 个，全部按层导入；画布通用命令已收进 canvas-data）
```

**依赖方向（已核对单向）**：kernel ← canvas-data ← canvas-render ← plugins。
kernel 不依赖任何 @mini-canvas 包；canvas-data 只依赖 kernel。

**验证基线（全绿，2026-09-14 实测）**：kernel **125** / canvas-data **257** / canvas-render **215** / ui **23**；
22 个插件包全通过（**872** 条）；另 mcp-server **47** / cloud-server **36**；累计 **1575** 条。
核心包 `tsc` 全 0 错、ui `vue-tsc` 0 错、ui 生产构建通过、
浏览器端到端实测（建节点/撤销重做/刷新恢复/设置面板）零控制台报错。

**本轮变更（2026-09-14）**：画布通用命令（建节点/删选中/撤销/重做）从独立插件包
`plugin-canvas-commands` **收进 `canvas-data`**（新 `src/canvas/canvasCommands.ts` 的 `registerCanvasCommands`，
宿主 `createMiniCanvasHost` boot 时默认注册，命令 id/keys 逐字不变 → 调用方零改动）；
同时删除死代码包 `plugin-custom-handle`（全仓无人 import，其端口几何常量与真正生效的
`plugin-theme-default` 数值不一致）。插件库 24 → 22 个。

**已知遗留（与本次无关）**：`plugin-theme-default` 的 `typecheck` 脚本用 raw `tsc` 处理 `.vue`，
报 `export type { X } from './X.vue'` 找不到导出（HEAD 里就存在）；其余 29 个包 typecheck 通过。

**本轮变更（2026-09-16）：画布交互配置收进「常规/画布」（对齐 v1 VueFlow 交互开关）**。
v2 渲染宿主此前只绑 minZoom/maxZoom（组件写死 0.2/2），其余 VueFlow 交互一律吃库默认值 ——
既不能配，且 5 处与 v1 行为不一致（edgesUpdatable/selectNodesOnDrag/zoomOnDoubleClick/
connectOnClick/onlyRenderVisibleElements）。本轮：
1. 新增 `canvas-render/src/contracts/canvasInteractionSettings.ts`（纯逻辑可单测）：18 项 schema
   （17 个开关 + 网格间距 X/Y）、默认值逐项对齐 v1 core、resolve/apply 纯函数（缺项/非法逐项回落默认）。
2. `createMiniCanvasHost` 在插件装载后、持久化桥 restore 前 `settings.define(常规/画布, …, 'canvas-render')`
   —— 宿主级声明不随插件热卸回收；用户已保存值命中快照作初值；设置面板自动长出这组配置，
   改动经 settingsPersist 跨刷新恢复。
3. `CanvasHost` boot 后把 settings 读成响应式 interactionSettings 并订阅 onChange 实时更新；
   `CanvasSurface` 全部绑到 `<VueFlow>`（nodesDraggable/nodesConnectable/elementsSelectable/edgesUpdatable/
   selectNodesOnDrag/snapToGrid/snapGrid/zoomOnScroll/zoomOnPinch/panOnScroll/panOnDrag/zoomOnDoubleClick/
   connectOnClick/onlyRenderVisibleElements/preventScrolling/minZoom/maxZoom）。行为对齐 v1：
   边可重连、拖节点不再顺手选中、双击不再缩放、点击不再连线、只渲染可见元素默认开。
   `CanvasHost` 的 minZoom/maxZoom props 兼容保留但不再生效（settings 单源）；ui demo 删除写死的传参。
4. 测试：canvas-render **241**（+16：schema/resolve/apply 12 条 + 宿主声明/持久化 2 条 + 原有全绿）、
   ui **23** 全绿、theme-default 118 / canvas-data 274 抽查全绿；canvas-render `tsc` 0 错、ui `vue-tsc` 0 错。

**修复（2026-09-16 同日）：auto-layout 的 minZoom/maxZoom 与宿主「常规/画布」撞 key 导致 boot 失败**。
settings 的 key 全局平面命名、define 重复 key 会抛错 —— auto-layout 的「聚焦最小/最大缩放」用了裸
minZoom/maxZoom，与宿主声明的画布缩放范围冲突（宿主先声明，插件装配即炸）。按本仓约定
（multi-select 的 multiSelectFrame*、align-arrange 的 alignArrange* 同例）改成 autoLayoutMinZoom /
autoLayoutMaxZoom，引擎内部字段名（AutoLayoutConfig.minZoom/maxZoom）不变。教训：新增设置 key
必须带语义前缀；裸通用词属于全局公共命名空间。

**修复（2026-09-16 同日二）：「常规/画布」改动不实时生效（用户实测反馈）**。
根因：CanvasHost 订阅回调里调用的 `applyCanvasInteractionChange` 是纯函数（返回新对象），
回调**丢弃了返回值**、没写回响应式 interactionSettings —— 链路断在最后一步，VueFlow 绑定永远拿旧值。
此前 12 条单测全测纯函数本身，恰好没盖住"回调把结果写回响应式对象"这一步（教训：接线层的
in-place 语义必须有测试锁，纯函数绿 ≠ 链路通）。修复：新增 `applyCanvasInteractionChangeInto`
（原地 Object.assign 写回、引用不变、无变化不触发、返回是否真改），回调改用它；+5 条测试
锁原地写回/无变化短路/不认识键短路/非法回落/snapGrid 元组联动。canvas-render **246** 全绿。

## 当前主线（2026-09-04，历史）：canvas-core-v2 重构 · 开发测试期最小闭环
目标：把旧画布(180 文件, `packages/canvas-core/src`)收敛成自研 Cordis 内核(`packages/canvas-core-v2`)，先做出"text + 最简 image 两节点、能拖能连能删、起 vite 看到、刷新不丢"的最小闭环。**红线：不碰 `src/`(老版宿主)，不把 M6 复杂件(image 裁剪/蒙版/25个交互插件/云)带进当前闭环。**

## 当前进度（哪个里程碑）
- ✅ M0：M1 内核(Scope/Context/topo) + tracer bullet 全链 demo —— 83 测试绿
- ✅ runbook 修订 + 核心节点件行为契约金标准已产出(见下方契约锚点)
- ✅ **M1(浏览器)最小闭环骨架**：vite + localStorageAdapter + image 插件 + NodeStore.removeNode + CanvasDemo
- ✅ **M2：NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot** —— core/registry(NodeRegistry 纯逻辑无 Vue) + nodeRenderer 解析 + components/BaseNode.vue
- ✅ **M3：命令/删除收敛** —— Selection/History/CommandRegistry/NodeFactory + command:delete/create-node/undo/redo + CanvasDemo 全走命令 + 最小右键菜单
- ✅ **M4：Save 层完整 + key 规范 + 生命周期 flush + 契约测试网** —— keys.ts + browserFlush(visibilitychange/pagehide) + saveContract.test
- ✅ **M5：连接内核（加固）** —— 原样吸收 v1 normalize/canonical/环检测/去重 + 声明式 inputs/accepts/limit；demo connect 走内核校验；connection.test(15 例) 锁死 v1 规则 —— 83 测试绿
- ▶️ **M1~M5 已全部达成**（runbook 主闭环完成）。M6(image 复杂件/Video/panorama/云等)= runbook 声明的**另开任务**，红线不并进当前闭环。
- ✅ **插件抽独立包(dsh 范式) 最小样板**：text/image 节点抽成 `packages/plugins/plugin-node-{text,image}` 独立 workspace 包，UI(content .vue)+逻辑一体、随包注册(`registerNodeType`)，宿主按 `bootCanvas({plugins})` 清单加载、零手 seed —— vite demo 可拖/连/删/编辑/刷新恢复，101 测试全绿。插件开发指南：`packages/plugins/README.md`。
- ✅ **M6 开篇：四个节点各自独立成包并复刻 v1 能力**（2026-09-12，用户指定开启 M6 的节点子项）：
  - `plugin-node-text`：加底部状态栏（字数/行数/复制/删除）；修掉编辑框拖拽坑（nodrag/nopan）、补外部写回同步（撤销/重做后画面跟着变）。
    （⚠️ 本轮还加了"顶部操作条（加粗/字号/颜色/对齐）"，**下一轮已被用户否决并删除**——对文本节点无语义，见下方工具层那条。）
  - `plugin-node-image`：补回 v1 的节点控制端——顶部操作条（上传 → dataURL 落 data、裁剪入口）+ 底部状态栏（文件名/宽×高/大小/裁剪中/失效）+ 裁剪覆盖层（可拖可缩放、几何为纯函数）+ 旋转/下载；裁剪**原地替换** imageUrl，裁剪态只存组件本地（不写 `data._overlay`，避免刷新复活）。
  - `plugin-node-3d-preview`（新包）：照 v1 PanoramaNode 复刻 three.js 球体全景预览，拖拽转视角 / 滚轮缩放 / 重置；视角数学与贴图来源判定抽成纯函数。
  - `plugin-node-image-compare`（新包）：连两张图用可拖拽分割线对比，最多 2 条输入、FIFO 挤最老，分割线位置落 data。
  - 宿主 `packages/ui` 装配清单已加入后两个新插件；新增整装测试 `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（四类型注册/段齐全/可建可卸、无残留）。
  - 测试：四个包 + ui 整装共 **151 条**（text 36 / image 60 / 3d 25 / compare 25 / ui 5）全绿，内核 326 条与主题 74 条不受影响，四包 `tsc` + ui `vue-tsc` + 四包/宿主 `vite build` 全通过。
  - 其中含两条**渲染契约**测试（SSR 拿真实 HTML 断言）：`textToolbarsRender.test.ts` / `imageToolbarsRender.test.ts` —— 锁"上下状态栏确实渲染出来、只在选中时出现、纯图标按钮都有 title+aria-label"，避免只测内部 computed 而漏掉模板写错。
  - **仍未做**（属 M6 后续，别当成已完成）：扩展/蒙版/滤镜、Video 节点、AssetStore 资产落盘（当前上传走 dataURL）、云 authority。
    （"backend 生成模型与底部 prompt 栏"已在下一轮完成，见下方工具层那条。）
- ✅ **节点 AI 能力「工具层」+ 文本/图片节点按 V1 修正**（2026-09-12 第二轮，用户指定）：
  - **内核新增 `tools` 层**（`ctx.tools` / `ctx.get('tools')`，实现 `canvas-core-v2/src/services/toolRegistry.ts`，22 测试）：工具 = 拿画布上下文调**外部能力**（与 command=画布内部动作 分工）。声明式 `params` 让节点 UI **自动**长出控件；`produces`/`accepts` 让节点按需筛选；`invoke` 把"同步返回"与"提交后轮询"两种第三方形态**归一化**，异常/超时收敛成 `{ok:false,error}`。加新模型 = 装一个工具插件，**节点与内核零改动**。契约已写入 `docs/plan/canvas-core-v2-api.md` §3.2b。
  - **新包 `plugin-tool-image-generation`**（53 测试）：把第三方图片生成 API 包成工具（照 v1 的 5 个模型能力声明，id 原样保留）。同时导出 PluginModule（宿主一行装载）与纯工厂函数 `createImageGenerationTools` / `registerImageGenerationTools`（**可在别处注册复用**，host 收 ctx 或裸 ToolRegistry）。可注入 fetch、可配 baseUrl，**不做假图 mock**。
  - **图片节点底部改成「生成图片」控制栏**（照 v1 ImageBottomToolbar）：上游素材小卡片行（图片缩略图/文本卡片，可点开大图，末尾 + 加素材）+ **大输入框（用用户自己的 ProseMirrorEditor，支持 @ 引用素材）** + 模型与该模型声明的参数下拉 + 发送。面板**不认识任何模型名**，只 `ctx.tools.list({produces:'image'})` 取工具、按 `params` 自动渲染下拉。生成成功写回 `data.imageUrl`（一次写完，含尺寸、清旧图描述；可撤销可落盘），失败只显示不落盘。
  - **文本节点按 V1 修正**：删除顶部加粗/字号/颜色/对齐工具栏（对文本节点无语义）与相关样式命令/字段；内容区改回 V1 的**透明底、无边框、无 outline 就地编辑**（p-4 内边距、**回车换行不提交**、Esc 取消、blur 提交、双击进入编辑）；底部状态栏**水平居中**（原 left:0 左贴边）。
  - 测试：相关包共 **842 条**全绿（内核 348 / 渲染 187 / 主题 74 / text 16 / image 106 / 3d 25 / compare 25 / 工具 53 / ui 整装 8），六包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"图片节点经 ctx.tools 发现能出图的工具""能按吃文本输入筛工具""运行期热插工具"三条，锁住工具链闭环。
- ✅ **控制栏贴边距离可配 + 图片节点尺寸跟随图片**（2026-09-12 第三轮，用户指定）：
  - **控制栏偏移进配置**（分组 `布局/控制栏`，key `toolbarTopOffset` / `toolbarBottomOffset`，默认 6、范围 0-40）：节点顶部操作栏、底部生成面板、文本底部状态栏原本各自写死 `calc(100% + 6px)`，现全部改由配置驱动。读取收口到 `canvas-render` 的 `useToolbarOffsets()` / `toolbarOffsetStyle()`（订阅设置变化**实时生效**、卸载退订、读不到/非法值回落 6px），避免三处各抄一遍漂移。放在 theme-default 而非各节点插件：settings key 全局一张表先声明者独占，且"浮层离卡片多远"属节点外壳几何，与既有 `titleOffset` 同类 —— 日后加视频节点白拿。
  - **图片节点宽高跟随图片**（照 v1 的 fitCardSize 规则）：`ratio = min(上限宽/图宽, 上限高/图高, 1)`，只缩小不放大，下限 120×80，量不到尺寸则保持原尺寸不猜。上限可配（`imageFitMaxWidth`/`imageFitMaxHeight`，分组 `布局/图片节点尺寸`，默认 420×300 = v1 的 MAX_PREVIEW_WIDTH/HEIGHT）。**四处写回在同一次 patch 内带尺寸**（上传 / 裁剪 / 旋转 / AI 生成出图），保证一次撤销退回原样而不是"退半步"；另在 ImageContent 加**幂等兜底**（挂载补缺失尺寸、imageUrl 变化时跟随），覆盖后台/MCP 直接写节点与旧数据。
  - 顺带补上主题变量 `--canvas-node-text-body`（文本节点正文色此前只能走硬编码回落值）。
  - 测试：相关包共 **892 条**全绿（内核 348 / 渲染 200 / 主题 74 / text 19 / image 140 / 3d 25 / compare 25 / 工具 53 / ui 整装 8）。新增测试锁：偏移解析与 CSS 拼接（含非法值/0 值/无关键不重渲染）、尺寸适配边界（大图缩小、小图不放大、比例、下限、非法返回 null）、四处写回各只产生一条撤销记录、兜底监听幂等。
  - 已知既有问题（非本轮引入，报错文件与 HEAD 逐字节一致）：`plugin-theme-default` 的 `tsc --noEmit` 会对 `components/ui/index.ts` 报两条 `.vue` 类型再导出错误 —— 该包 typecheck 用裸 tsc 跑不了 .vue 类型，需换 vue-tsc。
- ✅ **控制栏多选收起 + 文本节点生成控制栏 + 下拉统一组件**（2026-09-12 第四轮，用户指定）：
  - **多选时所有控制栏（上+下）都不显示**：根因是选中判定写成"我在选中集里" → 框选 N 个节点会并排浮出 N 份面板。新增共享判定 `canvas-render` 的 `useSoleNodeSelected()` / `isSoleSelected()`（语义 = **恰好选中一个节点且就是我**，对齐 v1 NodeToolbar 的 `getSelectedNodes.length === 1`），图片顶部操作条、图片生成面板、文本生成栏三个段组件全部改用它；两个包各自的 `useNodeSelected.ts` 删除（避免再有人用错判定）。
  - **文本节点底部改成与图片同款的生成控制栏**（`TextGeneratePanel.vue`，替换原 `TextBottomToolbar.vue`）：大输入框（用户的 ProseMirrorEditor，支持 @ 引用上游素材）+ 模型下拉 + **参数下拉**（思考程度这类就是工具 `params` 的一项，面板不认识它们）+ **模板下拉** + 发送；生成结果**直接写回 `data.text`**（一次写完，走 graph，可撤销可落盘），所以结果会出现在输入框里可继续编辑。字数/行数读数与复制、删除动作并入该栏。工具来源 = `ctx.tools.list({ produces: 'text' })`，**本包不认识任何模型名**。
  - **下拉统一用项目自己的组件，彻底去原生**：`plugin-theme-default` 导出 `Select` / `Dropdown` / `PrecisionSlider`（原本只在本包内部用），图片与文本面板的原生 `<select>` 全部换成 `Select`，视觉与设置界面同源；测试断言渲染结果里**不再出现 `<select` 标签**。
  - **内核工具层补两个声明位**：`ToolDef.templates`（预设提示词模板，工具作者声明、面板自动出"模板"下拉，加模板不用改节点）+ `resolveToolTemplates()`（含 `forTools` 共享模板收集与同 id 去重）；图片工具插件随即补上 v1 的 3 条模板（高清写实/留白极简/海报感）。
  - 测试：相关包共 **933 条**全绿（内核 354 / 渲染 206 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 整装 8）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。新增测试锁：多选时上下控制栏均不渲染、单选渲染、模板/参数下拉按声明长出来、无原生 select、文本写回是"一次写入"、失败不落盘。
- ✅ **控制栏布局数值全部进设置 + 设置页面覆盖度兜底**（2026-09-12 第五轮，用户指定）：
  - 用户反馈"这些配置应该也要写到我的设置页面中"。核对后：偏移项（`布局/控制栏` 的上/下控制栏偏移）、图片尺寸上限（`布局/图片节点尺寸`）、生成后台三项（`常规/图片生成`）**已在设置页**（已在浏览器实测确认）。
  - 但审计发现仍有几处**用户可见的布局数值写死在面板 CSS 里**，本轮一并做进 `布局/控制栏`：`panelImageWidth`（图片生成栏宽度，默认 650）、`panelTextWidth`（文本生成栏宽度，默认 520）、`panelEditorMinHeight` / `panelEditorMaxHeight`（生成栏输入框高度区间，默认 64–220）。读取收口到 `canvas-render` 的 `useGenPanelMetrics()`（与 `useToolbarOffsets` 同语义：订阅实时生效 / 卸载退订 / 非法值回落默认）。
  - 顺带修掉一个真 bug：图片生成面板原先用"固定负 margin"做水平居中，宽度改成可配后该偏移必然错位 —— 改为 `translateX(-50%)`，并把居中与反缩放 `scale` 合进同一个 `transform`（分写会互相覆盖）。面板背景同时改为与设置面板同材质的纯白（原为浅灰底）。
  - **新增设置页覆盖度测试** `packages/ui/src/__tests__/settingsCoverage.test.ts`：用真实内核 + 真实插件断言 `ctx.settings.groups()` 与关键键值，锁"这些配置确实会出现在设置页面里"，并约束一级分类只允许 `布局/常规/节点/边`、每个分组名都必须带二级段 —— 以后新增配置忘了写 group（界面上表现为"配置项凭空消失"）会被立刻拦住。
  - 测试：相关包共 **947 条**全绿（内核 354 / 渲染 215 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 14）；五包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。
- ✅ **生成能力注册独立成插件 + 参数支持自定义组件渲染**（2026-09-12 第六轮，用户指定）：
  - 用户问"图片生成/文本生成要如何注册"，要求**注册放在单独的插件里**，参数要有名称/描述/**指定组件渲染/甚至自定义组件**。核对：图片侧早有独立注册插件（`plugin-tool-image-generation`），但**文本侧完全没有注册方** —— 文本节点面板一直显示"无可用工具"。本轮补齐。
  - **新增 `plugin-tool-text-generation`**（31 测试）：与图片侧完全同构，把文本生成后台包成工具（`produces:'text'`，结果走 `ToolResult.text`）。内置 3 个模型（思考程度/长度档位各有差异），带 4 条预设提示词模板；`POST /api/tasks` 提交 + `GET /api/tasks/:id` 轮询，进度由内核转发。同时导出 PluginModule（宿主一行装载）与纯工厂 `createTextGenerationTools` / `registerTextGenerationTools` / `registerFromBackend`（**可在别处注册**）。Config 用 `textGen` 前缀避免与图片侧撞 settings key，分组 `常规/文本生成`。**绝不做假文本 mock**。
  - **内核 ToolParamDef 扩展**：补 `description` / `min` / `max` / `step` / `placeholder` / `span`（布局权重）/**`component`（自定义渲染组件）**/ `componentProps`。`component` 是 opaque 句柄（内核不解析、不 import Vue），约定 props `param / modelValue / disabled`、事件 `update:modelValue` —— **内置控件不够用时工具作者自带组件即可，面板与内核都不用改**。
  - **新增通用参数渲染器 `ToolParamField`**（theme-default 的 UI 组件，随包导出，9 测试）：按声明渲染 select/string/number（有范围走滑块，否则数字输入）/boolean，**并优先使用 `param.component`**。图片与文本两个生成面板的参数区都改用它（删掉各自的参数下拉样板），于是"自定义组件"在两个节点上同时生效。
  - 顺带修一个真 bug：参数回写此前一律 `String()` 化，会把开关的 `true` 变成 `"true"` 发给后台、数值参数也会变成字符串。现按类型保持原值，并新增 `paramRaw()` 供渲染器取原值。
  - 测试：相关包共 **998 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 45 / image 142 / 3d 25 / compare 25 / 图片工具 54 / 文本工具 31 / ui 17）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"两类生成工具并存且互不混入""参数声明字段齐全（label/description/options）"。
- ✅ **文本/3D 节点双态 + 图片对比宽度跟随**（2026-09-12 第七轮，用户指定）：
  - **文本节点两态**（用户原话："第一种是预览，只显示内容，超出隐藏就行，双击才进入编辑状态，提供滚动条，拦截画布的滚轮（缩放画布）"）：新增纯函数 `textViewMode.ts` 定判定（编辑态 > 缩略 > 首行截断 > 全文预览；预览态一律裁掉且**不**拦滚轮；编辑态给滚动条且把滚轮从画布手里抢过来）。编辑框除类名 `nowheel`（VueFlow 按 `closest('.nowheel')` 跳过 d3-zoom）外另加 `stopPropagation` 作双保险。新增按 nodeId 记名的会话态 `textEditSession.ts`（**不写 data** —— 写进去会落盘/进历史/被复制），顺带让"编辑态到底有没有滚动条、有没有拦滚轮"能被无头渲染直接断言（过去只能靠肉眼）。
  - **3D 预览节点两态**（用户原话："也是双击进入，进入之后可以转动视角，默认模式下是用来拖拽节点的"）：新增 `panoramaMode.ts` 把"哪种模式吃事件"收成一个开关 —— **预览模式（默认）3D 画面 `pointer-events:none`、不挂 nodrag/nopan/nowheel**，于是按住画面就是拖节点；**交互模式（双击进入）**才接管指针与滚轮（拖拽转视角 / 滚轮改视野角），Esc 或**点画布空白**退出（经内核 `RenderEvents.PaneClick`，对齐 v1 的 paneClick 收起 `_editing`）。模式会话 `panoramaSession.ts` 同样不写 data（v1 写 `data._editing`，得靠 `sanitizeForSave` 手动抠掉才不落盘 —— v2 没这层兜底，写进去必然刷新即卡在交互模式）。交互模式无论有没有图都显示"怎么退出"的提示（用户是被关进来的，不说明白会以为节点坏了）。
  - **图片对比节点宽度跟随第一条连线**（用户原话："他的宽度应该跟第一个连接线连接的图片的宽度一致"）：新增纯函数 `compareFit.ts` —— 只认**第一条连线**（两张图宽度不同就以先连的为准）、宽度取上游图片节点的**显示宽度** `data.cardWidth`（即用户实际看到的那个宽度，不是原始像素）、**拿不到就不猜**（保持原宽度，猜错比不跟随更糟）、**幂等**（算出来等于当前就一次都不写，否则监听自己触发自己转死循环 —— 与 imageFit 同一教训）。只跟宽度不动高度（高度留给用户拖）；`cardWidth` 与内核 `size` 同一次写回（只改一个会让相连边端点停在旧宽度）。
  - 测试：相关包共 **1051 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 45 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；text / 3d / compare / image 四包 `tsc` + ui `vue-tsc` + 三包与 ui `vite build` 全通过。本轮新增 7 个测试文件、60 条，其中三个是**渲染契约**（SSR 拿真 HTML 断言）：`textContentRender` 锁编辑态有没有 `nowheel` 与滚动条、`panoramaContentRender` 锁预览模式画面有没有真的 `pointer-events:none`（只看画面容器，不看模板注释）、`imageCompareWidthRender` 用记录型假 graph 锁"连上图之后确实写回宽度"。

## 现在立刻该做的一件事
### 本轮：connectEdge 统一建线入口 + handle 匹配真 bug（用户指定，2026-09-16）
- 用户指出（原话）：「我觉得你这个逻辑依然存在 BUG。我的很多操作都会创建新的连接线，不管是多选批量创建还是拖拽到空白处创建节点的时候（自动创建连接线，这是右键菜单插件的逻辑）还有普通拖拽建立连接线，或者历史记录什么的。我认为你应该做一个添加连接线的函数，在这个地方解决 evictOnFull / capability 两个属性，还有验证连接线是否有效的地方，只有全部通过之后才创建」。

#### ① 真_bug：3d-preview 的"只接一条"完全失效（用户实测报的）
- **根因**：具名口容量统计写成 `e.targetHandle === effectivePort`，而声明里的 `port` 是 `'target'`、**真实拖拽建出的边 targetHandle 是 null**（edgeStore 不存默认 handle）→ `null === 'target'` 永远为假 → 容量统计恒为 0 → 永远不挤。
- **修法**：`validateConnection` 与 `pickOverflowEvict` 两处统一改为 `e.targetHandle ?? 'target' === effectivePort` —— 具名声明的 target 口与"默认 target 口"是**同一个口**，无 handle 的边必须算进去。补 2 条测试锁死（含多具名口场景：无 handle 边只算进它真正落到的那个口）。

#### ② connectEdge —— 全路径统一建线入口（按用户要求的架构）
- **背景**：画布里建线至少有 5 条路径（普通拖线 / 右键菜单拖到空白自动建节点 / 生成面板加素材 / 多选批量连线 / 云端合并与粘贴），以前每条路径各自决定"要不要校验、满了怎么办"，这是容量 bug 反复出没的土壤。
- **改法**：`graph.connectEdge(input)` 一个函数管完：**校验 → 满额挤出 → 落边**，返回结构化结果 `{ edgeId, status: ok|rejected|duplicate, reason?, evictedEdgeId? }`（空串丢原因的老问题一并解决）。`addEdge` 保留为薄包装（老调用方零改动），事务句柄同样暴露 `tx.connectEdge`。
- **迁移**：普通拖线（CanvasHost.commitEdge，删掉自查 + 手写幂等）、右键菜单真边、生成面板加素材（删掉自算挤出与 `oldestIncomingToEvict` import）、多选批量连线、云端合并、剪贴板粘贴 —— **全部走 connectEdge，没有旁路**。唯一例外仍是 `data.transient` 临时脚手架边（跳过校验/挤出）。
- `imageOps` 的 `inputCapacity` / `evictEdgeId` 参数一并删除（接口瘦了，插件作者不用再理解这些）。

#### 验证
- 浏览器实测（真实拖拽）：**3d-preview 拖第二条线 → 第一条被挤掉**，始终只有一条（修前两条并存，用户截图报的正是这个）。
- 全量回归：canvas-data **274**（新增 7 条：connectEdge 五条 + handle 匹配两条）/ canvas-render 227 / node-image 148（含改 2 条旧语义断言）/ node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / multi-select 126 / ui 23 全绿；7 个包 tsc 干净。

### 上一轮：连接容量的正确语义 + 加边守门人（用户指定，2026-09-16）
- 用户纠正（原话）：「你一直在强调图片的 capacity 是1，但是我这里图片输入端口分明是可以添加多条连接线的」「最初提出这个 capacity 是因为我有一个 图片diff 节点…只有它只能连接2条连接线，其他的节点都没有限制」「这里默认就是挤，当前没有任何一个节点为拒」「你这里添加连接线的时候 绝对不能绕过这个规则检验」。
- **用户是对的，V2 迁移时把容量语义弄窄了。** 查 V1（packages/canvas-core/src/nodes/*）：image/text 只声明 acceptsInputs（**只限类型、不限条数**），全靠 image-compare 自己手写「超了挤最老」。V2 给所有节点都加了 capacity:1，行为随之变窄。

#### ① 容量的三条语义（改前 / 改后）
- **改前**：capacity 未声明 = 当 1 用（只接一条）；满额一律 limit-reached 拒。→ 图片/文本节点接不了第二个上游；而「挤老边」因为 `if (capacity < 2) return null` 这道门槛**从未生效过**。
- **改后**：
  - **不声明 capacity = 不限条数**（image / text 现在都不声明，回归 V1 语义）；
  - 声明了且满额 → **默认挤老边**（evictOnFull 缺省 true），落边时先删最老一条再加新的，同一条历史记录；
  - 只有显式 evictOnFull:false 才满额直接拒（当前**没有任何节点**用这个，与用户要求一致）。
- capacity 现在只有两处声明：3d-preview = 1（换图）、image-compare = 2（保留最老两条）。
- image-compare 顺带从「上限 2 + 1 个缓冲位 = 3」改回**如实的 2** —— 那个缓冲位是「内核不会挤」时代的 workaround，现在不需要了。

#### ② 挤出决策收口成唯一实现
- 新增内核纯函数 pickOverflowEvict()（canvas-data/canvas/connection.ts），与 validateConnection 的容量段**同源**。
- 以前这条决策散在三处：CanvasHost.evictOldestIncoming（还带着 capacity < 2 的死门槛）、plugin-node-image 的 imageOps 自己算一遍、image-compare 又用「缓冲位 + 边变化订阅」绕过一遍。**判定分散 = 行为漂移**，这正是「同一条边拖线能连、批量连却被拒」的根因。现在只有一份。

#### ③ 加边守门人：任何入口都不能绕过校验
- **漏洞**：graph.addEdge 是「图唯一写入口」，但**完全没有校验** —— 插件 / 云端合并 / 测试脚本都能把自连、成环、重复、类型不符的边直接塞进图。我上一轮就是误用这个后门「验证」图片能连多条，得出的是假结论。
- **改法**：graphDocument.addEdge 落闸（addEdgeGuarded）—— 规则不过就不落边（返回空串）。挤出也一并在这里做，同事务原子。
- **例外**：data.transient 的临时脚手架边不校验（拖线途中的占位边端点可能还没进 store），也不参与挤出。
- 新增 5 条测试锁死：自连 / 重复 / 成环 / 类型不符全部拦下；transient 边正常放行。**浏览器实测**同样四类非法边全部被拦（返回空串、一条没落）。
- 顺带把 registerNodeType 里**手抄的 inputs 字段列表**换成复用 PortDef —— 正因为抄了一份，新增 evictOnFull 时插件写了会被类型误拦。

#### 验证
- 浏览器实测（真实拖拽）：两个图片源拖到同一图片目标 → **两条都连上**（修前第二条被拒）。
- 浏览器实测：image-compare 连第 3 条 → 自动挤掉最老一条（保留最新两条）。
- 全量回归：canvas-data **267** / canvas-render 227 / node-image 148 / node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / group 21 / multi-select 126 / ui 23 全绿；五个包 tsc 干净。
- 更新了 7 条断言旧语义的测试（canvas-data 连接内核 5 条 + context-menu 1 条 + image-compare / 3d-preview 各 1 条）：它们锁的正是被改掉的旧行为，按新规则重写而非删除。

### 上一轮：批量连线的"部分支持"语义（用户指定，2026-09-16）
- 用户原话：「多个节点 可以拖是拖拽一条连接线 你的目标节点应该如何判断是否可以链接？比如只要部分连接线支持就可以链接（链接的时候也只允许支持的连接线进行连接）不能一股脑的直接建立连接线」。
- **先查清了"一股脑"到底发生在哪**（三个场景浏览器实测）：落边本身**一直是逐条校验**的（类型不符、容量已满、类型级部分支持三种都只落了合法的那几条），所以"全建进去"并不存在。真正的三处问题在别处：

#### ① 容量不在批内累计 —— 这是真正会"多建一条"的漏洞
- 内核 `validateConnection` 判容量看的是"目标输入口**现有**入边数"。批量落边时每条边各自查一次图，**兄弟边互相看不见**：目标口 capacity=1 时，3 个合法源会各自都判合法、3 条一起落进只装得下 1 条的口。
- 改法：新增纯函数 `planBatchApply(specs, { isDuplicate, canConnect })`，其中 `canConnect(spec, **alreadyPlanned**)` 第二个入参就是"这一批里已经决定要建的边"。组件的 `validateBatchEdge` 把已计划的边并进"现有边"一起喂给内核校验。顺序即优先级（先到先得），与单条拖线"先连上的占住口"一致。
- 实测：两个合法文本源拖到容量 1 的文本目标 → 只落第一条（修前会落两条）。

#### ② 目标可连性被"某个源不合法"整体判死
- 原来用 `resolveFeedback` 按**单个源**跑，某一个源不合法就把整个目标画成"不可连"——哪怕别的源明明连得上。
- 改法：几何命中与合法性**解耦**。resolveFeedback 只负责回答"aim 到哪个节点"（validate 恒返回空串），合法性改用整批结论：`plan.build.length > 0` 即"至少有一条能连"→ 目标亮"可连"；一条都连不上才按非法处理，并把真实原因（如"类型不匹配"）透到气泡。
- 注意"已存在"**不算非法**：那条边本来就在，按可连显示。

#### ③ 预览与落边是两套独立判断（迟早漂移）
- 改法：预览与落边**共用同一份** `batchPlan`（computed），做不到"所见非所得"。
- 临时线新增 `willConnect` 位：连不上的那条加 `is-rejected` 压暗（opacity 0.28 + grayscale），用户在**松手前**就看得见"这一拖只有几条会成"。不用虚线是因为线型来自用户可配的主题，再叠一层 dash 会与配置打架。
- 实测：text 源 + image 源一起拖到 text 目标 → 一条线正常、一条压暗到 0.28、目标显示可连；松手只建 `text→text` 那条（`image→text` 被内核以 type-not-accepted 拒）。

#### 顺手抓到并修掉一个我自己引入的严重 bug
- `onBatchUp` 里先执行了 `batchSide.value = null`，之后才读 `batchPlan.value` —— 而 batchPlan 是依赖 batchSide 的 computed，于是**恒为 null，一条边都建不出来**（表现为"预览两条线都对、松手什么都没有"）。改为**先取计划、再清状态**，并在注释里标明顺序不可调换。

#### 测试与回归
- multi-select **126 条**（新增 10 条：`planBatchApply` 六条 —— 含"容量 1、两个源各自合法只落第一条"这条回归；`markGuideLines` 四条 —— source/target 两侧对号入座、duplicate 也算会连上、不改动其它字段）。
- 回归全绿：canvas-render 227 / canvas-data 258 / theme-default 118 / ui 23；`vue-tsc` 对本轮改动文件零报错。

### 上一轮：多选框"缩放后 padding"bug + 父子级方案取舍（用户指定，2026-09-16）
- 用户反馈（原话）：「你的这个多选框缩放之后的 padding 存在 BUG 你这里框选的话 你认为是做成一个节点 给框选的节点设置 父子级？？还是目前这种让框选直接跟随画布的缩放，那个好一些？？」

#### ① 缩放后 padding 的 bug：间距与线宽不在同一个空间
- **实测数据**（间距配 24 / 外框线宽 4 / 内框线宽 2；"重叠"= 两条线各半宽之和 > 屏幕上间距）：

  | zoom | 屏幕上间距 | 外框线宽 | 结果 |
  |---|---|---|---|
  | 2 | 48px | 2px | 正常 |
  | 1 | 24px | 4px | 正常 |
  | 0.5 | 12px | 8px | 临界 |
  | 0.3 | 7.2px | 13px | 重叠 2.3px |
  | 0.2 | 4.8px | 20px | **重叠 10.2px** |
- **根因**：两框**线宽**按 1/zoom 反缩放（屏幕恒定粗细），而 **padding 是 flow 常量**（屏幕上 = 配置 × zoom）。缩得越小线越粗、间距越窄，两条线最终糊成一条。
- **改法**：新增纯函数 `scaleFramePaddings(pads, zoom)`，把间距也除以 zoom —— 让"间距"与"线宽"用**同一套空间约定**：配置值恒等于"你在屏幕上量到的值"。zoom 非法/≤0 回落 1（绝不产生 Infinity 把几何算炸）。
- **同时补上另一半**：`refreshFrame` 的 watch 依赖里加了 `viewport.zoom`。少了这一项，缩放画布后间距会**停在旧缩放算出来的值**上，与线宽对不上 —— 单改 scaleFramePaddings 是不够的。
- **实测结果**：修后屏幕上间距在 2 / 1 / 0.5 / 0.3 / 0.2 五档缩放里**恒定 24px**，再无重叠（修前 0.2 时重叠 10px）。

#### ② 父子级 vs 跟随画布缩放：建议继续用现在这套
- **结论：不改成父子级。** 理由是项目里已经有真正的父子级分组（`plugin-group`，走 `parentId` + `toRelativePosition`），两者职责重叠，硬把框选也做成父子级会直接打架。
- 跟随缩放这套（浮层 + 自己贴 viewport 变换）的**实际优势**：① 不写数据、不进历史，框选不该污染文档；② 不参与图结构，不会影响连接校验/导出/后端；③ 跨顶层节点本来就是常态，而父子级要求所有节点归到同一个父下，语义反而拧巴；④ 已是当前架构，改造成本为零。
- **父子级唯一真正占优的地方**：节点很多、缩放很小时，浮层要按虚拟化只画可视区（`visibleRect` / `visibleNodes`）—— 这一条是性能问题，不是正确性问题，等真出现几千节点再说。
- **要让观感与线宽同空间**这件事，父子级并不自动解决（它解决的是"拖动时要不要重算"），仍要像本轮这样把间距按 zoom 换算。所以换方案并不能省掉这个 bug 的修法。
- 唯一与本方案有关的小麻烦：拖动中用"快照 + 位移"跟手（不能每帧重算并集），这是已解决的历史坑（见 dragFollow 的注释与回归测试）。

#### 测试
- multi-select **116 条**（新增 6 条：`scaleFramePaddings` 的 zoom=1 原样 / zoom=0.5 翻倍 / 非法值回落 / zoom=0.2 间距不被线宽吃掉；渲染契约两项 —— 间距随缩放换算、缩小时两框不糊在一起）。
- `vue-tsc` 对本轮改动的文件零报错。

### 上一轮：批量连线的"端口直接用 MovingHandle / 3D 反馈 / 多源"三问（用户指定，2026-09-16）
- 用户反馈（原话）：「你的多选框左右的 2 个 movinghandler 效果不对，有没有办法直接使用 MovingHandle.vue？有没有办法直接讲他导出，然后在我的这个多选插件中导入他 并且使用？？其次就是拖拽到目标节点上的时候没有那种 3d 动效 之前你的这个判断写在了什么地方？？ canvas-render 还是 plugin-theme-default 判断连接线是否可以链接，这里之前判断的是只有单个连接线，现在可能需要让他支持多个？？」
- **三个问题各自的根因都定位到了（实测 + 读代码得出，不是猜的）**：

#### ① 端口"效果不对"：不是没复用 MovingHandle，而是拿 !important 去改它的定位
- 现状：多选框上**本来就是**主题的 MovingHandle（preview 模式，上一轮已导出并导入）。但外面套了个 **0×0 定位点**，再用 !important 把 top/transform 压回 0，去绕开组件自带的 top:50% !important。
- **改法**：删掉那两条 !important 覆盖，改成**顺着组件的契约走** —— 给定位盒一个**真实高度**（= 跟随区高），它自己的 top:50% + translateY(-50%) 就自然落在盒子垂直中点上、跟随区上下各露一半，与节点端口同一套几何。以后改跟随区高度也不用再动定位代码。
- 顺带修了跟随区高度的算法：原先写成 (portZoneHeightRatio ?? 0.8) * 100（把一个 0~1 的**比例**硬乘 100 当 px），跟节点那边"节点高 × ratio"完全不是一回事。现在基准 = **选中集里最高的那个节点的高度** × ratio，并留 72px 下限。实测跟随区从 22.5×60 变成 **45×120**，与节点端口逐字一致。
- 还修了"端口拖不动"：圆球永远画在跟随区**里面**、跟随区 z-index 更高，所以按下命中的是跟随区、圆球收不到 mousedown（preview 模式下没有 VueFlow Handle 那层兜底）。改为**两条入口都接**（connect-start + 定位盒的 mousedown），函数内做幂等判重，不会装两套监听。

#### ② 拖到目标上没有 3D 动效：喂给反馈几何的矩形**字段名写错了**
- **判断写在哪里**：连接**规则本身**在 packages/canvas-data/src/canvas/connection.ts（validateConnection：自连 / 成环 / 重复 / 类型 acceptsTypes / 容量 capacity），**不在** plugin-theme-default —— plugin-theme-default 只管"长什么样"（CustomEdge / MovingHandle / BaseNode）。
- **真因**：nodeLayout 给的是 { x, y, w, h }，而渲染层 resolveFeedback 要的是 { x, y, width, height }。少了这一步转换 → width/height 恒为 undefined → 吸附带 / body 命中全算成 NaN → hover 永远 null → hoverNode 永远写不进去 → BaseNode 的 3D 条件（showConnectFeedback → isConnectionValidTarget）永假。
- **改法**：新增纯函数 toNodeRects(rects)（nodeLayout 形 → NodeRect 形）并在组件里走它；同时把命中用的吸附带配置从写死的 DEFAULT_SNAP_ZONE_CONFIG 换成渲染上下文里的 snapZone（宽 42 / 高占比 0.8），与"从节点端口拖线"**同一份配置**（原先宽 undefined → 吸附带塌成 0 宽，永远吸不到端口）。
- **浏览器实测**：拖到干净目标 → 卡片 .v2-card.is-connecting-hover + transform: perspective(800px) rotateX(...) rotateY(...) scale(1.018)（3D 回来了）；拖到已有入边的节点 → is-connection-invalid + 气泡"已存在同一条连线"；松手落边 68-77 成功（69-77 因目标容量 1 被内核正确拒绝）。

#### ③ "之前判断的是只有单个连接线，现在需要支持多个"
- **改法**：ActiveConnection 增加可选 sourceNodeIds?: string[]（**缺省 = 单源语义，逐字不变**），并新增渲染层共用判定 isConnectionSource(active, nodeId)（单源比 sourceNodeId、多源查集合）。BaseNode 的 isCurrentConnectingNode 改为走它 —— 这是"我算不算拖线源"的唯一维护点，散在各处必然漏掉多源那一路。
- 多选插件起手时把**整个选中集**写进 sourceNodeIds。**实测**：拖线中两个源节点的左右端口都变 is-disabled（修前只有第一个）。

#### 测试与回归
- multi-select **110 条**（新增 6 条：toNodeRects 三项 —— 含"拿真实 resolveFeedback 断言转换后能命中 / 不转换则永远命中不了"的对照；端口定位不得再用 !important；跟随区高度算法两项）；canvas-render **227 条**（新增 4 条 isConnectionSource 单源 / 多源 / 空数组回落）。
- 全量回归：canvas-data 258 / theme-default 118 / ui 23 全绿；canvas-render tsc 干净。
- 浏览器实测：整组拖动、端口跟随鼠标（球随鼠标 943→958）、Shift 加选、批量落边均正常。
- **已知既有问题（非本轮引入，未修）**：plugin-multi-select / plugin-theme-default 的 typecheck 脚本用**裸 tsc**，处理不了 .vue，于是 SelectionFrame.vue 的 script setup 里**类型错误不会被 CI 拦住**（本轮 ① 的猜数错误就是这么漏进来的）。本次改用 vue-tsc 复核：这两个包我的改动无报错，剩余报错来自 prosemirror-editor-bundle 与三个既有测试文件。

### 上一轮：批量连线补齐"N 条线 + 目标反馈"（用户指定，2026-09-15）
- 用户反馈（原话）：「我要的连接线是 从多选中每一个节点 对饮端口创建一条连接线到鼠标位置 / 你没有get到这一点而且当前 他移动到目标节点上的时候 没有任何效果？？ 比如这里的3d 动效，什么模糊（失败检测什么的）你这里都没有实现」。
- **确认了两处缺失**：① 上一轮只画了**一条**线（从多选框边缘出发），不是"每个选中节点各一条"；② 完全没写渲染层的连接反馈状态，所以目标节点上没有 3D 倾斜 / 模糊 / 气泡。

#### ① N 条临时线（每个选中节点各一条）
- 新增纯函数 `buildBatchGuideLines(side, selectedIds, rects, cursor, snap?)`：每个选中节点**从他自己的外侧端口锚点**连到鼠标（或吸附点）。右侧拖出从各节点右缘中点出、左侧反之；吸附时所有线都指向目标端口锚点。拿不到矩形的节点跳过（不瞎猜位置）。
- 组件里把单条 `guideLine` 换成 `guideLines` 数组，模板 v-for 渲染，每条都用主题 `ConnectionLine`（内部委托 `CustomEdge`）→ **与正式边同款**。
- 浏览器实测：拖动中 `.conn-line-shell` 数量 = 2（选中 2 个节点各一条），截图可见两条线汇聚到鼠标。

#### ② 目标节点连接反馈（3D / 模糊 / 气泡）
- **根因（对宿主连接机制读完后确认）**：目标节点的 3D 倾斜、非法模糊、气泡都由渲染层的 `connectionState` 驱动（`isConnecting`/`activeConnection`/`hoverNode`/`suppressHandles`），BaseNode 只消费它。我上一轮完全没写这些状态，所以拖到目标上"什么效果都没有"。
- **改法**：批量连线开始/结束时写同一份 `connectionState`（开始：`activeConnection` + `suppressHandles`；结束：全部清空）——**与宿主 `beginConnection`/`endConnection` 同语义**；每帧拖动用渲染层现成的 **`resolveFeedback` 纯函数**（吸附带/body 几何命中 + 内核 `validateConnection` 校验 + `reasonText` 文案）算出 hover 并写 `hoverNode`。这样目标节点的反馈与"从节点端口拖线"**同一套逻辑、同一套观感**，不是我另做一份。
- **两个实测踩出来的坑**：
  1. **`isConnecting` 是 computed（派生自 `activeConnection`），不能直接赋值** —— 直接写无效且不报错，反馈静默失效。只能写 `activeConnection`。
  2. **flow 坐标换算必须用渲染层官方的 `screenToFlow`** —— 手写公式（`(client - pane - vp) / zoom`）实测算出错误 flow 坐标导致 hover 永远 null；官方换算后坐标正确、命中正常。
- **浏览器实测**：拖到 67（image 类型）上 → 卡片出现 `is-connecting-hover`（3D 倾斜 + 蓝色高亮），截图可见；松手落边 `68->67`（`69->67` 因容量 1 被 `limit-reached` 正确拒绝）。

#### 测试与回归
- multi-select **104 条**（新增 5 条：`buildBatchGuideLines` 的方向/吸附终点/跳过无矩形/空选集），`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / theme-default 118 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：拖未选中节点时框乱动 + 多选框端口拖不动（用户指定，2026-09-15）
- 用户反馈（原话）：「1, 我拖拽未选中的节点的时候你的这个选框也在移动 2. 你的多选框 的 movinghandler 无法进行拖拽 建议你可以观察一下 vender/vueflow的源码？使用codegraph」。
- **按建议读了 `vendor/vueflow` 源码**（`packages/core/src/components/Handle/Handle.vue` + `composables/useHandle.ts`、`useVueFlow.ts`）：
  - `Handle` 的按下走 `@mousedown="onPointerDown"` → `useHandle.handlePointerDown`，且**必须能 `findNode(nodeId)`**（`if (!fromHandleInternal) return`）—— 即真实连接点必须挂在某个节点上；这印证了"多选框上的端口不能用真 `Handle`、只能用 `MovingHandle` 的 `preview` 模式自己 emit"是正确路线。
  - 也确认了 d3-zoom 的平移挂在 `.vue-flow__viewport` 的 `mousedown`（前几轮已实测过），与本次两个 bug 无关但一起复核了。

#### ① 拖未选中的节点时选框跟着动
- **复现（量化）**：多选 68+69，按住**未选中**的节点 70 拖 6 帧 → 框逐帧 `368→382→396→410→424→438`（与 70 完全同步），节点位移 140、选中集没变。
- **根因**：`RenderEvents.NodeDragStart` 里我**无条件**记下"拖动锚点"，于是拖任何节点框都会跟随。框代表的是**选中集**的包围盒，没被拖的成员不在选中集里就不该理它。
- **改法**：抽出纯函数 `shouldFrameFollowDrag(draggedNodeId, selectedIds)`（= 被拖节点在选中集里才跟随），在 `NodeDragStart` 用它判定；不在选集内就把锚点置空、整段拖动都不跟随。
- **浏览器决定性验证**：把未选中的 70 移到不重叠处后拖它 → 拖动中框**恒定不动**（327→327），70 正常移动（829→899），拖后框 Δ0 / 节点 Δ200 / 选中集不变；探针确认走的是 `skip` 分支。

#### ② 多选框上的端口无法拖拽
- **根因**：`onPaneCaptureDown`（挂在 `.csurface` 捕获阶段、判断"框内空白 = 整组平移"）**把端口上的按下也接管了** —— 端口球就画在多选框边缘**内侧**，几何判定把它算成"框内空白"，于是这次按下被抢走、`MovingHandle(preview)` 的 `connectStart` 收不到事件。
- **改法**：抽出纯函数 `isHitOwnBatchPort({batchSlot, movingHandle})`，在接管判定里排除"命中本插件端口/端口槽"的落点，让给端口自己处理。
- **浏览器验证**：多选后按下右侧端口球 → **引导线立刻出现**（修复前完全没有反应）；端到端拖到目标节点上成功落边 `68->70`。
- 顺带说明：这轮排查中我发现过一次"按点落在 69 却以为在按 70"的假象（两节点屏幕重叠）—— 用元素命中反查所属节点后确认判定一直是对的，避免了一次误修。

#### 测试与回归
- multi-select **99 条**（新增 5 条：`shouldFrameFollowDrag` 的"选中成员跟随 / 未选中不跟随 / 空选集"三条 + `isHitOwnBatchPort` 的两条），`tsc` 干净。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：批量连线端口改用主题 MovingHandle + 临时线用 CustomEdge（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的UI 样式和效果 都存在问题 / 我要的是 和 当前 MovingHanlde 一样的效果， 拖拽的时候也是使用 ConnectionLine / CustomEdge 这个组件 / 你的这个给我整笑了」。
- **我上一轮做错的地方**：批量连线端口我自己手画了一个白底圆片按钮（`border-radius` + 内联 SVG 加号），拖拽时画的是一条 `stroke-dasharray` 的虚线。用户要的是**和节点端口、和正式边完全一致**的观感 —— 我这是另造了一套，必然漂移。
- **改法一：端口复用 `MovingHandle`（preview 模式）**。它本来就内置了 `preview` 语义 —— 渲染成 `span` 而非 VueFlow 的 `<Handle>`（不注册真实连接点）、并 emit `connectStart`，正是为"挂在自己浮层上的临时端口"准备的。现在多选框左右两侧各挂一个，`rest-offset`/`cursor-gap`/`button-size`/`zone-*` 全部取自同一份 `handleParams`，所以**外观、半圆跟随区、圆球跟随动画、180ms 归位淡出、显隐规则全部与节点端口同源**。
- **改法二：拖拽临时线复用 `ConnectionLine`**。该组件内部把渲染**完全委托**给 `CustomEdge`，所以拖出来的临时线与落成的正式边**长得一模一样**（导轨/流光/箭头/配置/动画）。并按它的注释要求把 `sourcePosition/targetPosition` 正确设为 right/left（硬编码方向会把贝塞尔控制点翻到内侧、曲线往反方向弯）。
- **为此把两个渲染件从 theme-default 导出**（`MovingHandle` / `ConnectionLine` / `CustomEdge`），并把 `@mini-canvas/plugin-theme-default` 加进多选插件的依赖 —— 否则就是"各自手绘一套"的老路。
- **两个实测踩出来的坑**：
  1. **MovingHandle 的锚点 CSS 有 `top:50% !important`**，直接给它内联 top 会被覆盖（实测端口渲染到 y=-1182，跑到画布外）。解法：外面套一个**零尺寸定位点** `selection-frame-batch-slot`，由它决定锚点落在大框左/右缘的垂直中点。
  2. **引导线起点不能读端口球的位置** —— 球会跟着鼠标跑（它就是跟随区），读它会得到抖动/错位的端点。改为读**定位点**的位置（稳定不动）。
- **测试**：本包 **94 条**（新增 1 条渲染契约：端口确实是主题的 `moving-handle-anchor` + `is-preview` + `port-follow-zone`，左右各一个 → 锁"复用同一组件、不各画一套"）；`tsc` 干净。
- **浏览器实测**：多选后左右两侧各出现一个与节点端口同款的白色圆球（带 + 号）；按住圆球拖出 → 临时线由 `ConnectionLine`/`CustomEdge` 渲染（DOM 实测 `conn-line-shell` + 13 个 path，与正式边同款）；松手落在节点上 → 按类型/容量规则落边（实测新增 `68->70`；`69->70` 因目标输入口容量为 1 被内核 `limit-reached` 正确拒绝）。
- **副作用说明**：为让 vite 解析新依赖，重启了 5288 的开发服务器（新依赖需要重新预构建）；源文件未受影响。

### 上一轮：多选时禁止对齐吸附（用户指定，2026-09-15）
- 用户反馈（原话）：「这里多选的时候 应该禁止 我的对齐节点（对齐插件 - 拖拽的时候那个参考线）」。另问：「你的这个多选框是如何实现的？？ 使用的是父节点还是其他的方式？」
- **架构答复（多选框不是父节点）**：`SelectionFrame` 是**独立浮层组件**，注册进 `overlay` 槽，与 VueFlow 的节点层是**兄弟关系**（不是父子）。它自己贴一层与 VueFlow viewport **完全相同的 transform**（`translate(x,y) scale(zoom)`）把框定位在 flow 坐标系；几何取自 `nodeLayout` 的矩形并集；整组拖动由它自己算（逐帧视觉写 + 松手经 graph 落盘）。好处：不碰 VueFlow 内部结构、不依赖节点父子关系，普通节点与 group 子节点一视同仁。
- **根因**：对齐插件的吸附实现是 `updateNodeVisual(被抓住的那个节点, 吸附后位置)` —— 它只动**一个**节点。多选整组拖动时，这一下会把组里被抓住的那一个单独吸到对齐位、其余成员留在位移后的位置，**整组的相对位置被弄乱**。实测：参考线出现 1 条、且整组位移被吸住（预期 140 只走了 130）。
- **改法**：新增纯函数 `shouldAlignOnDrag(selectedCount)` —— 选中 <= 1 才对齐，多选一律让位。`AlignGuideOverlay` 在每帧拖动里读当前选中数，多选时**不吸附也不画线**（用 `hideGuides()` 只清参考线、保留 `primaryId`，因为拖动还没结束、主节点不能丢）。
- **单一职责**：判定放在对齐插件自己的引擎里（"要不要对齐"是它的事），多选插件不反向依赖它，两插件仍互不认识。
- 测试：本包 **28 条**（新增 2 条：单选/未选中参与对齐、多选不参与），`tsc` 干净。
- **浏览器实测（含对照，证明没把单选对齐弄坏）**：单选拖动 → 参考线最大 **1 条**（`align-guide-hline`，对齐仍生效）；多选拖动 → 参考线最大 **0 条**（已禁止）。验证时打开的对齐开关已按用户原状态恢复为**关闭**。
- 全量回归：multi-select 81 / theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：第二次拖框清空选中 + 拖节点时框漂移（用户指定，2026-09-15）
- 用户反馈（原话）：「第一次拖拽多选框（空白区域）可以进行拖拽，拖拽之后 选框没有消失 / 但是第二次不管我是拖拽节点还是 多选框 他的多选中黄台都会消失 / 图2 是第二个问题，拖拽里面节点的时候 你的多选框位置错误， 你看看你拖拽结束之后 是如何设置 多选框位置的， 拖拽结束之后的多选框位置是正确的」。

#### ① 第二次拖拽后选中被清空
- **复现**：第一次拖框 → 选中保住（正常）；**第二次**拖框（或拖节点）→ 松手后选中变空。
- **根因（探针实测的守卫状态）**：两次拖拽的事件链对比 —— 第一次 `click → swallowed:true`（守卫生效）；第二次 `pointerdown 时 armed:true`。
  即：`groupDragArmed`（上一轮为"抵消紧随的 mousedown"加的标记）**从未被消费**（因为我们在 `pointerdown` 上做了 `preventDefault`，浏览器就不再补发 `mousedown`），于是第二次按下时它还是 true → 处理函数走进"抵消 mousedown"分支直接 return：**既没开始新的拖动、标记又被清掉**，最后补发的 click 穿过去把选中清空。
- **改法**：把"这次 mousedown 要不要抵消"改由 `isDragging`（真的在拖）判断，**不再用这个易失灵的标记**：
  - `isDragging === true && e.type === 'mousedown'` → 抵消（d3-zoom 的入口）；
  - `e.type === 'pointerdown'`（新手势开始）→ 作废上一次遗留的吞 click 标记。
  删掉 `groupDragArmed` 这个中间状态（它同时兼任两个语义，是这次 bug 的来源）。
- 浏览器实测：**连做三次拖框，选中每次都保住**（`["68","69"]` ×3）；随后再点真正空白 → `[]`（清空回归正常）。

#### ② 拖动节点时框位置漂移（松手才跳回正确位置）
- **复现（量化）**：拖节点 68 时逐帧测"框相对选中节点并集的外扩量"，从 `(-7, -9)` 一路漂到 `(-7, -21)`，**松手后又跳回** `(-7, -9)`。
- **根因**：上一轮我把拖动跟随实现成"每帧用**实时位置 + 其余节点的 store 位置**重算并集"。但 VueFlow 原生拖动**只在松手时落盘**，所以拖动中途 store 里被拖节点的位置还是旧的 —— 于是并集把"新位置"和"旧位置"混在一起，框越算越偏。用户观察到的"松手后才正确"正是因为这个：松手落盘后 store 变新，重算就对了。
- **改法**：与整组拖动**统一成同一种算法** —— 用"框快照 + 位移量"移动框（`followFrame`）。拖动时记下框快照与"抓着的那个节点的起始位置"，每帧只算该节点的位移量再平移框。这样框与节点走同一个 delta，相对偏移天然恒定，不需要读 store、也不受落盘时机影响。
  - 只认"抓着的主节点"的帧：多选拖动时 VueFlow 会给每个成员各发一帧，用同一节点算位移才严格同步。
- 浏览器实测：拖动中逐帧外扩量**恒定 `(-17, -23.5)`**（修前漂到 -21），松手后一致，选中同时保住。

#### 测试与回归
- multi-select **81 条**（新增 4 条：连续三次手势各自吞掉自己的 click / 漏掉"新按下作废"会让标记失效这个坑本身 / 逐帧位移量推进偏移恒定 / **对照**"重算并集会漂移"的修前错误形态）。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。

### 上一轮：拖动后选中被清空 + 单选圈改自绘 SVG（用户指定，2026-09-15）
- 用户反馈（原话）：「当前选框可以拖拽了，但是拖拽之后我的 选中状态也会被情空 / 还有你的多选UI 效果 节点内部左上角的那个单选样式 请使用自定义svg 把，你的这个ui效果很难评 直接使用svg替代把」。

#### ① 拖动结束后选中被清空（复现 + 根因 + 修法）
- **复现**：选中 68/69 → 在框内按住拖动 → 松手 → 选中变空（拖动**期间**选中还在，只有松手那一下被清）。
- **根因（事件探针实测的事件序列）**：`pointerdown@window → pointerup@window → pointerup@pane → click@window → click@pane` —— 松手后浏览器**补发了一个 `click`**，VueFlow 的 pane click 语义是"点空白 = 清空选中"，于是刚拖完的选中被这一下清掉。
- 这与我早先修的"Shift 框选后选中被清空"是**同一个病**，当时已经写了状态机 `boxSelectGuard.ts`（`BoxSelectClickGuard`）。本轮直接**复用它**：整组拖动结束时 `markGestureDone(true)` → 紧随的那次空白 click 在**实例根捕获阶段**被吞掉；并在每次新的 `pointerdown` 时 `reset()` 作废未消费的标记（松手点若落在节点上、浏览器不补发 click，标记不能留到下一次误吞真实点击）。
- 浏览器实测：拖动前 `["68","69"]` → 拖动后 `["68","69"]`（**保住**），节点 Δ133；随后**再点一次真正空白** → `[]`（清空回归正常，守卫没有误吞正常点击）。

#### ② 单选圈改为自绘 SVG（用户要求）
- 原实现是 CSS 画的圆（`border-radius` + 边框 + 中心伪元素），用户认为效果不佳。改为**内联 SVG**：`viewBox 0 0 20 20`，两个 `<circle>` —— 外圈（白底 + 2px 主题色描边）+ 中心实心点（选中态）。
- 好处：矢量、任意缩放下都清晰；颜色统一走 `currentColor` / `var(--canvas-node-border-selected)`，**跟随主题**而不是写死色值。
- 尺寸：容器 26×26、距卡片左上各 8px，仍按 `1/max(zoom, titleScaleMinZoom)` 反缩放（屏幕上大小恒定）。纯指示不接事件（`aria-hidden` + `pointer-events:none`），点击行为仍归卡片（Shift+点节点 = 取消该节点选中）。

#### 测试与回归
- theme-default **118 条**（新增 1 条：标记确实是 `<svg>` + 两个 `<circle>` + 有 `viewBox`，锁"用自绘 SVG 而非 CSS 画圆"）；multi-select **77 条**、`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过。
- 三项行为最终浏览器实测：①框内拖动 → 选中保住、节点 Δ133、画布 Δ0；②拖动后再点空白 → 正常清空；③框内滚轮 → zoom 0.450→0.682（穿透缩放照旧）。

### 上一轮：多选框三处交互修正（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的选框 有问题，我只说了 鼠标滚轮可以透传，鼠标左键平移节点你给我弄错了 / 拖拽这个多选框是平移这个多选框和选中的这些节点 / 还有就是多选之后 在节点的左上角（内容区域）添加一个单选框的这个圆形单选UI（用来区分当前节点是否选中）需要写入到 baseNode 中（default-theme 插件中）/ 其次就是我拖拽节点的时候 你的多选框没有实时生效，移动节点之后当我鼠标松开的时候它才触发这里的多选框位置重置」。

#### ① 左键拖框 = 平移框 + 选中节点（修正上一轮做错的地方）
- **上一轮的错误**：为让节点可点，我把框内部设成事件穿透，于是左键落在框内空白被 VueFlow 当成"拖空白 = 平移画布"。实测确认：节点 Δ0、画布 Δ75。
- **这一轮的做法**：框**整体**不接事件（节点完整可点），改在**画布层按几何判断**该不该接管 —— 落点在框内、且不在任何节点上 → 这次手势归"整组平移"；落在节点上则原样放过（节点选中/拖动照旧）。
- **三个坑（全部实测定位，非猜）**：
  1. **监听必须挂在 `.vue-flow` 的祖先（实例根 `.csurface`）的捕获阶段**：d3-zoom 的平移挂在 **`.vue-flow__viewport` 的 `mousedown`** 上（深度调试实测查到的），拦 pane 拦不住；
  2. **`pointerdown` 与 `mousedown` 是两个独立事件，必须都拦**：前者是 VueFlow 的入口、后者才是 d3-zoom 的入口。只拦前者 → 画布仍被拖走（实测节点在动、画布也在平移）；用 `groupDragArmed` 标记把同一物理动作的第二个事件一并拦掉；
  3. **`preventDefault` 会抑制该 pointer 的兼容鼠标事件**：一旦在 `pointerdown` 上 preventDefault（抑制原生拖拽/选中文字），后续 `mousemove` 就不再来 —— 拖动必须用 **`pointermove`/`pointerup`** 驱动（踩过：监听 mousemove 导致拖动全程收不到事件）。
- 浏览器实测：框与节点**逐帧同步**平移（框 525→589 / 节点 541→605），两个节点各移 178，**画布 Δ0**；最终回归：节点 Δ160、画布 Δ0。

#### ② 节点左上角的多选圆形单选标记（写入 BaseNode）
- 在 theme-default 的 **BaseNode** 内容区左上角加 `v2-multi-radio`：白底圆环 + 中心实心点，**只在多选（选中 >=2）时出现**（单选时卡片已有选中环，再叠一个圆点反而多余）。
- **纯指示、不接事件**（`pointer-events:none` + `aria-hidden`）：点击行为仍归卡片本身，这样 Shift+点节点 = 从选中集里去掉它，逻辑不被装饰层挡掉。
- 圆圈按 `1/max(zoom, titleScaleMinZoom)` **反缩放**，与标题同一套语义：屏幕上大小恒定，缩到 0.2x 时不会小成一个点。

#### ③ 拖动节点时框实时跟随（原先只在松手后跳一下）
- **根因**：VueFlow 原生拖动**逐帧只改渲染层**（`updateNode` 内部状态），位置要**松手才落盘**；而框只订阅了 `nodeStore`，所以整个拖动过程中框定在原地、松手那一瞬才"跳"过去（正是用户截图看到的现象）。
- **改法**：订阅渲染层逐帧广播的 `RenderEvents.NodeDragStart/NodeDrag/NodeDragEnd`（宿主已有这套事件），按"拖动中的实时位置 + 其余选中节点的 store 位置"重算并集。
- 关键细节：**不能只记一个节点的位置** —— 多选拖动时 VueFlow 会给每个被拖成员各发一帧，必须把它们的实时位置都存下来（`liveNodePos` Map），否则框会按"一个动了、其它还在原地"的并集抖动。
- 浏览器实测：拖动节点时逐帧 `[框 left, 节点 left]` = 589/605 → 607/623 → 625/641 → 643/659 → 661/677，**差值恒定 15px**（框与节点完全同步，不再松手才跳）。

#### 测试与回归
- multi-select **77 条**（更新 2 条：原"四条拖动把手"的断言改成"框整体不接事件且没有把手元素"，与新设计一致）；theme-default **117 条**（新增 4 条：多选出现圆点 / 单选不出现 / 未选中不出现 / 圆点是纯指示不接事件）。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。
- 说明：验证期间发现 **5288 的开发服务器已停止**（端口无监听），已重新拉起（`packages/ui` 的 `pnpm dev`）以便继续端到端验证。

### 上一轮：多选四项体验问题（用户指定，2026-09-15）
- 用户反馈（原话）：「1. 多选的时候 可以设置是否显示标题（config配置开关 这里的padding计算看是否需要更新）2. 使用shift框选的时候禁止出现节点的上下控制栏（NodeToolbar）3. 使用浏览器检查，你可以发现多选的时候他们的z-index 存在问题，我希望的是节点在最上面 因为这样我就可以加减选了，（当前我多选之后无法操作节点，不能做到单独取消某个选择）4. 在多选区域这个位置让他支持 鼠标滚轮穿透（也就是这里的 缩放画布）」。

#### ③ 节点在框之上、可加减选（最关键的一项）
- **根因不是框的 z-index，而是整个 overlay 层压在节点之上**：CDP 实测节点 `.vue-flow__node` 是 `z-index:1000`，而框所在的 `.csurface-overlay` 是 `z-index:20` —— 但节点在 `.vue-flow__viewport`(z:4) 这个**堆叠上下文**内部，它的 1000 只在里面生效；overlay 是 viewport 的**兄弟**且 z=20 > 4，于是**整个浮层盖在整棵 VueFlow 之上**。再叠加框的容器是"铺满、`pointer-events:auto`"的矩形，结果就是节点中心 `elementFromPoint` 命中 `selection-frame-outer` —— 点不到节点，自然没法单独取消某个选中。
- **改法（浮层内部让出事件，不动框架层级）**：大框拆成两层 —— `selection-frame-outer` 只做**视觉**（`pointer-events:none`），另加 `selection-frame-grips` 沿大框边框铺**四条薄把手**（`pointer-events:auto`）承接整组拖动。框内部彻底留空 → 事件落到节点上。
- 为何不改 overlay 的 z-index：节点有**动态选中环**（::after box-shadow）与浮动端口，一旦把节点抬到浮层之上，这些会被盖住，代价更大；而在浮层内部让出事件既解决问题又不碰既有层级契约。
- 浏览器实测：节点中心命中回到节点内容（`preview`）；**Shift+点节点可单独取消选中**（`["68","69"]` → 点 68 → `["69"]`）；框内空白命中 `vue-flow__pane`（穿透到画布）；四条把手到位。

#### ④ 多选区域滚轮穿透缩放
- **根因**：VueFlow 的 wheel 监听挂在它的 canvas 容器上，而框在 `.csurface-overlay`（另一个分支、且铺满）—— 滚轮事件到不了画布，`preventDefault` 也没人做。
- **改法**：浮层上加 `wheel` 监听（`passive:false`），把事件**转发**给 `.vue-flow__viewport` 元素。为何是转发而不是自己算 zoom：VueFlow 的缩放中心要按鼠标在画布内的位置算，自己调 zoomTo 会变成"以画布中心缩放"，手感不对；转发一个真实 wheel 给它，缩放中心/增量/动画与直接在空白处滚完全一致。
- 浏览器实测：框内空白 -300 → zoom 0.300→0.455、+300 → 0.455→0.300；**左/上/右三条拖动把手上**滚轮同样生效（0.12→0.209→0.364→0.209），且缩放中心跟随鼠标（x/y 同步变化）。

#### ② 框选期间不出现上下控制栏（NodeToolbar）
- **改法**：框选手势开始时把渲染层已有的 `interaction.selecting` 置位（`beginSelecting`，对齐老版 `canvasStore.isBoxSelecting`），BaseNode 据此把上/下插槽整层不渲染；松手或组件卸载时复位（`endSelecting`，含 detach 兜底，防止热卸把位卡在 true）。
- 浏览器实测：单选 image 节点时插槽容器在（`上插槽:在/0`、`下插槽:在/1`）→ 框选中两个都**从 DOM 移除** → 松开后恢复。
- 顺带：多选（>=2）时同样收起（面板语义本就是"恰好选中一个"），与既有压制条件合并到同一个 `hideToolbars`。

#### ① 多选时是否显示标题（config 开关）
- **改法**：新增配置 `multiSelectHideTitles`（「多选时隐藏节点标题」，默认关）。BaseNode 按"开着 + 处于多选"两条同时成立才隐藏标题条。开关放在 multi-select 插件（它才是"多选"这件事的语义归属，把多选框的配置集中在一处；settings key 是全局平面命名，theme-default 按名字读）。
- **关于用户提到的 padding**：默认关掉隐藏时，`两框间距（上）` 的语义与数值都不变，**不需要联动改**；只有用户**主动开启**隐藏后才可能想调小它，故在 description 里写明"关掉隐藏后若想让大框仍兜住标题，把两框间距（上）适当调大"，不引入隐式的自动改值（自动改会覆盖用户设定）。
- 另外补了 `multiSelectFrameEnabled` 总开关（默认开）：关掉即不画两个框，多选本身照常可用。
- 浏览器实测：开关打开后单选 70 → 标题显示；多选 70+67 → **标题隐藏**；回到单选 → 恢复显示。

#### 测试与回归
- multi-select **78 条**（新增 7 条：总开关不画框、框选中不画框、面板指针穿透（外观层不接事件 + 把手恰好四条 + 把手只铺边框的尺寸）、两个开关的 schema 与脏值回落）；theme-default **113 条**（新增 6 条：框选中插槽整层不渲染、多选插槽不渲染、单选照常渲染、hideTitles 多选隐藏/单选不隐藏/默认不隐藏）。
- 全量回归：canvas-render 223 / canvas-data 257 / ui 23 / node-text 64 / node-image 147 / align-guide 26 全部通过；multi-select `tsc` 干净。

#### ⚠️ 并行改动的处理说明
- 本轮工作期间**同一工作区存在另一个进程在改代码**（`plugin-node-image/ImageTopToolbar.vue`、`plugin-theme-default/components/ui/*`、`canvas-render/nodeLayoutSettings.ts` 等并非本轮改动的文件也在变，并新增了 `NodeToolbarButton.vue`、`baseNodeSlotsRender.test.ts` 等文件；期间出现过一次 HMR 编译错误与一次写文件被占用）。
- 我的改动与之**没有冲突**：对方把 BaseNode 的上下控制栏从"单个段组件"重构成"可叠多个 occupant 的上/下插槽（`topSlots`/`bottomSlots` → `.v2-slot--top/--bottom`）"，而我加的 `hideToolbars` / `showTitle` 两个压制条件被**完整保留并接进了新的插槽模板**（两处 `v-if` 都带 `!hideToolbars`）。验证时已按**重构成后的新类名**重新取证。

### 上一轮：小框（内框）也能设圆角与 padding（用户指定，2026-09-15）
- 用户反馈（原话）：「框选之后 你这里内部的这个最小 rect 框 我也希望可以设置圆角 和 padding」。
- **圆角本来就能设**：上一轮已把「内框圆角」的默认值改成 0（直角），配置项一直在设置里。本轮再确认了它能改（设 14 → 屏幕上 28px，按 1/zoom 反缩放），并补了测试锁住"不是写死直角"。
- **新增「小框外扩」（本轮的主要工作）**：以前只有"两框间距"一个 padding，它管的是大框离小框多远，**小框自己没有任何可调的外扩**（永远紧贴节点并集）。现补三项 —— `小框左右外扩` / `小框上方外扩` / `小框下方外扩`（key `multiSelectFrameInnerPadding{X,Top,Bottom}`），默认全 0。
- **几何改成逐层往外算**：`节点并集 → 内框(+小框外扩) → 外框(+两框间距)`。原先 `ComputeSelectionFrameGeometry(rects, padding)` 只有一层，现在签名扩成 `(rects, gap, innerPadding)`；两个 padding 的默认值各自独立（小框 0/0/0、间距 16/34/16），故**默认观感与之前逐像素一致**。三条几何不变量用测试钉死：小框 = 并集 + 小框外扩、大框 = 小框 + 间距、大框永远包住小框（不管小框扩多大都不交叉）。
- **顺带把设置项名字说清楚**：原先那三项 label 叫「群组框左右/上方/下方内缩」，容易跟新的"小框外扩"混起来（都带"内缩/外扩"字样却管不同东西）。改名为 `两框间距（左右/上/下）`，description 同步重写为"大框（外）与小框（内）之间留多少"，与新三项形成"大框↔小框 间距 / 小框↔节点 外扩"的清晰对照。
- **配置 → 几何的转换收口成 `framePaddingsOf(cfg)`**：把一份外观配置拆成 `{ inner, gap }` 两组 padding，组件不再手抄六个字段（抄错一个就静默错位）。
- 测试：本包 **71 条**全绿（新增 10 条：几何 4 条锁逐层语义与大框包小框、配置 4 条锁三项默认 0 与 `framePaddingsOf` 拆解、渲染契约 2 条锁"配了值内框真的变胖且大框跟着外推"与"不配时仍严格等于节点并集"），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**（真 dev server）：默认态小框相对并集四边均为 0、两框间距 16/34/16；设 12/24/8 后小框四边精确外扩 12/24/8 而两框间距仍是 16/34/16（说明间距是相对小框算的）；内框圆角设 14 → 计算样式 28px（= 14/0.5 反缩放）；设置面板「布局 → 多选」列出「两框间距（左右/上/下）」+「小框左右/上方/下方外扩」+「内框圆角」；验证后把配置恢复为默认（持久化里只剩显式写入的 0 值，与默认一致）。

### 上一轮：内框去掉圆角（用户指定，2026-09-15）
- 用户反馈（原话）：「你的内部框有一个 圆弧，我不希望有这个 圆角效果」。
- **现象确认**：默认配置下内框圆角是 12px（按 1/zoom 反缩放后屏幕上 17.14px），四个角明显是圆的 —— 选中框要"紧贴选中节点的并集"，而节点并集是个正矩形，圆角会让四条边在角上提前弯掉、看起来没贴住。外框的圆角（6px 虚线大框）保留不动。
- **改法**：`DEFAULT_MULTI_SELECT_FRAME.inner.radius` 12 → **0**（直角）。该配置项本身保留（`内框圆角` 仍可在设置里调，想回圆角就调大），只改默认值 —— 不是把圆角写死成 0。
- 测试：本包 **61 条**全绿（新增 3 条：配置默认为 0、默认渲染出的内框 `border-radius:0px` 且外框仍是 6px、圆角设 10 时能出 10px 证明没写死），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**：内框计算样式 `border-radius: 0px`、外框仍 `8.57143px`（= 6/0.7 反缩放）；放大到内框左上角目视四个角均为直角；设置面板「布局 → 多选」显示「内框圆角 = 0」。

### 上一轮：多选群组框「拖动时框位置错误」（用户指定，2026-09-15）
- 用户反馈（原话）：「拖拽的时候 选框位置错误」。
- **根因（浏览器实测量化定位）**：拖动整组节点时节点跟手是准的，但**框越跑越快**。埋点逐帧测量：鼠标拖 20/40/60/80/100px，框跑了 **20/60/120/200/300px**，漂移量 0/20/60/120/200 —— 正是三角数，说明每帧都拿"当前框位置"当基准又加了一次"从按下算起的累计位移"，位移被重复计入，第 n 帧偏差 = n 倍位移。
- **这是上一轮的自身回归**：清理冗余字段（innerOffset）时顺手把 `dragOuterBounds`（按下瞬间的框快照）删掉了，导致拖动跟随从"快照 + 位移"的绝对定位退化成"当前值 + 累计位移"的累加。修法即恢复快照语义。
- **抽成纯逻辑 `dragFollow.ts`**：`followFrame(按下时快照, 累计位移) → 两框新位置`。为什么值得单列 —— 这条几何最容易在清理重构时被顺手改错（本 bug 就是），抽出来才能直接断言"多帧推进后位移**恰好**等于累计位移"，并顺手把这个坑本身写进测试（同一文件里对比"误把当前值当快照 = 200px"与"正确 = 80px"两种写法）。
- 测试：本包 **58 条**全绿（新增 `dragFollow` 6 条），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 全部不受影响。
- **浏览器实测**（真鼠标手势，逐帧测量）：修复后拖 20/40/60/80/100px 框与节点**逐帧零漂移**；斜向/反向/纯横/纯纵四种方向拖动**以及松手落盘后**漂移均为 0.0px；zoom = 0.4 / 1.0 / 1.8 三档下同样零漂移（位移按 zoom 换算正确）；框内拖动、拖动中截图目视两框均紧贴节点。

### 上一轮：多选插件的框选失效与群组框双框错位（用户指定，2026-09-14）
- 用户报的两个缺陷（原话）：
  ① 「shift + 左键 在画布中框选的时候 框选完成之后并没有真实的框选，也就是操作完成之后没有任何选中状况，只有通过 Ctrl 一个一个加选才有效」；
  ② 「框选之后你的UI 存在异常，2个框竟然有重合」，并给出两框的定义 —— 「小框 就是根据选中节点计算的最小 rect 框（不包含标题）；大框 是根据一个固定的padding 进行的（这个请写在插件的config配置中）；你的小框和大框颜色和样式（比如使用实现还是虚线， 线框宽度，颜色等）写在config 配置中」。
- **缺陷①根因（浏览器实测定位，非猜）**：框选期间插件确实把命中节点写进了内核 selection（CDP 埋点可见逐帧写入 空→68→62,64,68 … 一路累加），但**松手后浏览器还会补一个 click 事件**，宿主的 onPaneClick 语义是「点空白 = 清空选中」（selectionInteractions.clickPane），于是刚框出的选中被这一下 click 全清掉 —— 用户看到的等价于「框选不生效」。Ctrl 逐个点选不走 pane click，所以看起来只有它有效。修法对齐老版 MultiSelectPlugin：框选真的发生（超过 4px 阈值）就给下一次 pane click 打「要吞掉」的标记，落点在画布空白时于捕获阶段 stopPropagation。两个坑一并堵上：**标记必须在新的 pointerdown 作废**（松手点落在节点上时 VueFlow 不派发 pane click，标记会留着误吞用户下一次真实点击）；**没拖动不算框选**（否则 Shift 点空白清空选中会失效）。判定抽成纯逻辑 boxSelectGuard.ts 的 BoxSelectClickGuard（零 DOM 可单测）。
- **缺陷②根因**：内框的 width/height 被写成了**外框**的尺寸（只有 left/top 用了 padding）。外框 = 并集 + padding、内框位置 = padding、内框大小却 = 外框 —— 于是内框被推到右下且比外框还大，两框交叉错位。新几何一次算清：multiSelectEngine.computeSelectionFrameGeometry 返回 { outer, inner, innerOffset }，其中 **内框尺寸恒等于节点并集**（不掺 padding）、只由 padding 决定它落在何处。另把内框从「外框的子元素」改成**兄弟节点** —— 嵌在里面时外框线宽配成 0 会把内框一起带走（新加的渲染契约测试当场抓到这条连坐）。
- **外观与间距全部进 Config**（用户要求）：新增 multiSelectConfig.ts，分组 `布局/多选` 共 **13 项** —— 左右/上/下三个内缩，以及内外两框各自的**颜色 / 线型（实线·虚线·点线）/ 线宽 / 圆角 / 填充%**。key 一律加 multiSelectFrame 前缀（settings key 是全局平面命名、先声明者独占，裸 color/paddingX 会被静默丢弃）。线宽与圆角按 1/zoom 反向缩放，与 cardFrame.ts 同约定 —— 配置值的含义恒为「你屏幕上看到的粗细」。改动经 settings.onChange 实时生效，无需重载画布。
- **默认值与 v1 逐项对齐**：三向内缩取 v1 的 `selectionFramePaddingX/Top/Bottom` = **16 / 34 / 16**（最初按 v2 旧代码写成 36，核对 `canvas-core/src/composables/useCanvasStore.ts:49-51` 后改回 34）。两框式样（外框灰虚线 + 内框浅蓝实线）也与 v1 SelectionFrame.vue 同名同值。
- **两条几何语义经 v1 逐行核对**（用户说「请参考 V1 版本」，故不只看表现）：v1 SelectionFrame 的 `canvasBounds` = 并集 + padding（= 大框）、`innerBoundsStyle` 的 width/height = **并集原样**（= 小框，`left/top` 才用 padding）。本实现与之一致 —— 缺陷②正是当初把内框尺寸写成了大框尺寸而偏离了 v1 这条规则。
- **顺带修正**：外框同时是整组拖动的把手，故它**永远渲染**（线宽配 0 时看不见但仍能按住拖动），不再随「线宽 > 0」条件消失。
- 测试：本包 **52 条**全绿（引擎 15 + 几何 6 + 守卫 7 + 配置 16 + 渲染契约 8），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响，ui vue-tsc 干净。本包此前无 vitest.config.ts（跑不了 .vue），本轮补上并与主题/text 包同款（@vitejs/plugin-vue + @vue/server-renderer），使「模板有没有把几何与配置真的贴到元素上」可被 SSR 真 HTML 断言 —— 这正是缺陷②的形态（几何算对、模板接错字段照样错位）。
- **浏览器实测**（内置浏览器 + 真 dev server，真鼠标手势）：Shift 框选空白起→空白止 **选中保住**（6 个节点，clear 调用从调用栈 trace 里消失）；框选后**再点一次空白仍能清空**（回归）；松手落在节点上 / 反向拖 / 只框一个节点三种路径均正确，且单个节点不画框；外框 500×101 而内框 494×91（并集原样、精确贴合）；改设置后外框 虚线·灰 → 点线·红、内框 实线·蓝 → 虚线·绿、内缩 16→40 全部即时生效；外框内拖动整组三节点位移一致且可撤销；设置面板「布局 → 多选」目视 13 项齐全。

### 上一轮：对齐辅助线补上「总开关」配置（用户指定，2026-09-13）
- 用户反馈：「你的对齐辅助线还缺少一个 config 配置，比如当前是否开启这个功能。只有在我开启这个功能的时候，你的插件才生效。需要将这种效果设置到 config 中进行配置」。
- **新增 `plugin-align-guide/src/alignGuideConfig.ts`**：导出模块级 `Config` schema，只有一个布尔项 `alignGuideEnabled`（默认开、label「启用对齐辅助线」、分组 `布局/对齐辅助线`），与老版 AlignGuidePlugin 的 panel 设置项同名同义。分组沿用项目既有四个一级分类（`布局/常规/节点/边`），不新立无主分类。
- **key 用 `alignGuideEnabled` 而非裸 `enabled`**：settings 的 key 是**全局平面命名**、先声明者独占 —— 裸 `enabled` 已被 `plugin-edge-cutting` 占用，撞名会被内核静默跳过、开关形同虚设（真实内核测试把这一点锁住了）。
- **关闭 = 浮层不装配**：插件本体只有「把 `AlignGuideOverlay.vue` 注册进 overlay 槽」这一件事，而浮层组件就是全部实现（订阅拖拽 → 算吸附 → 写 `updateNodeVisual` → 画参考线）。故关闭时**连槽都不注册**：不吸附、不画线、不订阅拖拽事件；打开即现装（组件重新挂载并重订阅），实时生效、不必重载画布。
- 装卸接线抽成纯逻辑 `alignGuideToggle.ts` 的 `bindAlignGuideToggle(ctx, attach)`：装配时按当前开关决定挂不挂，订阅 `settings.onChange` 跟着开关变；`apply` 里交给 `ctx.effect`，随插件 fiber 一起回收（热卸/重载不留残线、不误触别的插件配置）。
- 测试：本包 **26 条**全绿（引擎 13 + 配置 7 + 装卸 6），`tsc` 与 `vue-tsc` 干净；`packages/ui` 新增整装测试（真实插件模块装载 → overlay 槽里有没有它、关掉后实时摘除、装配即关则不出现、关着卸载不报错），ui **23 条**全绿、`vue-tsc` 干净；内核 361 条不受影响。原有 13 条引擎测试一条未改。
- 目验入口：`cd packages/ui && pnpm dev` → 顶部「⚙ 设置」→ 左导航「布局」→「对齐辅助线」→ 关掉后再拖节点，应既不吸附也不出参考线；重新打开即恢复。

### 上一轮记录
- ✅ **3D 预览：快捷键 + 全屏 + 去遮挡**（2026-09-12 第八轮，用户指定）：
  - **删掉常驻&quot;提醒&quot;与右上角重置按钮**（用户原话：&quot;这个提醒可以删除，这样会遮挡视线&quot;、&quot;删除你的右上角的 重置按钮&quot;）：`panoramaMode` 不再产出 `hint` / `showReset`（这两个字段连同样式一并删除），画面上除 3D 画面本身不再叠任何东西 —— 操作全部改走快捷键。
  - **全屏（f 切换）**：新增 `fullscreen` 会话态 + `Teleport` 全屏层（`z-index:100000`、纯黑无装饰）。实现方式是把 three 的 canvas **搬**进全屏层、退出再搬回节点内（不是重建渲染器：WebGL 上下文与贴图都在同一个 renderer 上，重建既慢又容易漏 dispose）。搬迁时同步 `ResizeObserver` 目标与相机宽高比 —— 这两个不跟着换，全屏就会按节点尺寸渲染一张铺不满的画面。
  - **节点快捷键 f（全屏切换）/ r（重置视角）**：全屏与重置都不再依赖按钮。r 的视角状态在组件内部，命令与组件互不认识，故经 `panoramaSession` 的&quot;重置请求计数器&quot;通信（命令 +1、组件 watch 到就去拉回相机；用计数器而非布尔，连按两次也各触发一次）。
  - **本轮的核心：快捷键优先级**（用户原话：&quot;注意这里画布也可能注册了 f，你需要有一个优先级，选中节点之后支持这些快捷键&quot;）。f/r 早已被自动布局插件占用（f=聚焦选中、r=适应视图），故给内核指令分发补两条规则：**① `when` 不满足 = 让位**（交给同键的其它命令，而不是&quot;命中即吃掉、execute 时被 when 拦成空操作&quot;——后者会把全局快捷键永久挤没）；**② `order` 小的赢**（order 相同才回落到注册先后，既有分发顺序不变）。宿主 `CanvasHost` 分发时把内核 ctx 作为执行上下文传入，`when` 才真正参与判定。节点侧用纯函数 `resolveCommandTarget` 界定&quot;什么时候归节点&quot;：**恰好选中一个、且它就是 3D 预览**才接管；没选/选的是别的类型/选了多个一律让位（多选时该操作哪一个不明确，不猜）。
  - **Esc 一次只退一层**（对齐 v1 PanoramaNode 的金标准：全屏时 Esc 只退全屏、人仍留在&quot;能转视角&quot;状态）：全屏 → 退回节点内仍可转视角 → 再按一次才回到&quot;按住就能拖节点&quot;。判定抽成纯函数 `resolveEscapeAction` —— 起因是发现最初写成 `if (fullscreen) exitInteract()` 两个分支做同一件事，等于一次跳到底，浏览器实测抓到后改掉。
  - 测试：相关包共 **1084 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；core-v2 / render / 3d 三包 `tsc` + ui `vue-tsc` + 3d `vite build` 全通过。本轮新增 4 个测试文件、26 条：内核 `commandDispatchPriority`（when 让位 + order 优先）、3d 的 `node3dCommands`（目标判定）、`node3dShortcuts`（真内核 + 真分发的整链优先级）、以及扩展后的 `panoramaMode`/`panoramaSession`/`panoramaContentRender`（全屏、Esc 分层、画面上不再有按钮提示）。
  - **浏览器实测**（内置浏览器 + 本地 dev server，用真键盘事件，不只跑测试）：f 进全屏（全屏层 canvas 实测 1280×720 铺满）、拖拽转视角后 r 回到初始朝向、Esc 逐层退出（fullscreen→interactive→preview）、以及优先级两种情形 —— 没选中时执行的是 `auto-layout:focus-selected`、选中 3D 节点时执行的是 `3d-preview:fullscreen`。

## 现在立刻该做的一件事
- ✅ **图片节点显示修复：铺满不留空隙 + 卡片尺寸跟上**（2026-09-13 第九轮，用户指定）：
  - 用户报的缺陷（原话）：&quot;你的图片节点显示有些问题，横屏图片 宽度大了几像素，竖屏高度大了几像素&quot;。用内置浏览器实测复现并量到确切数字：横屏图卡片外框 420×236 而图片只画到 416×234（左右各留 2px）、竖屏图卡片 169×300 而图片只画到 167×296.9（上下各留约 1.6px）。
  - **根因一：填充方式**。卡片是 `border-box` 且带 1px 边框，边框先从声明尺寸里扣掉，于是**内容区**比&quot;按图片比例算出的卡片尺寸&quot;矮胖了一点（差 2px）；`object-fit: contain` 在比例不吻合的框里必然在某一侧留白，所以&quot;节点比图片大几像素&quot;用 contain 消不掉。改为平时**铺满**（`cover`，与老版 ImageNode 的 `object-cover` 一致）。
  - **但裁剪时必须切回 contain**：裁剪覆盖层的遮罩与裁剪框都按 object-contain 几何计算（ImageCropper 的 `computeFit`），它底下就是这张图片；此时若仍铺满，遮罩会盖错、裁剪框指向错误的像素区域，裁出来不是用户框选的那块。故加 `is-fill-cover` / `is-fill-contain` 两态，随裁剪开关切换。
  - **根因二（顺手查出的真缺陷，更隐蔽）**：靠&quot;挂载时兜底补算尺寸&quot;的节点（后台/MCP 直接写节点、旧存档）**尺寸算出来了、卡片却不跟随** —— 内置浏览器实测 **8/8 稳定复现**：内核 data 与宿主渲染态都已是 420×236，但已挂载的节点组件收到的 `props.data` 仍是旧快照（只有 imageUrl/imageWidth/imageHeight、没有 cardWidth），卡片停在类型默认 320×240，16:9 的图被硬塞进 4:3 卡片。对照实验确认这是**挂载窗口内写入丢失**：挂载前写生效、挂载后写生效，只有正好落在这次挂载窗口内的写入会丢。修法：`onMounted` 的补算推迟到 `nextTick`，让写入落在挂载完成之后。
  - **浏览器实测**（内置浏览器 + 真 dev server）：横屏 420×236（比例 1.78 ≈ 图片 1.778）、竖屏 169×300（0.563 = 0.563）、正方形 300×300，全部&quot;卡片尺寸 = data 尺寸&quot;且图片铺满无空隙；8 个不同比例节点复测 7/7 正常跟随（第 8 个是 400×1200 的极细长图，宽度被设计下限 120px 抬起，属既有规则非缺陷）；裁剪模式切回 contain 且遮罩对齐、退出后恢复铺满。
  - 测试：相关包共 **1011 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 148 / 3d 71 / compare 46 / ui 23）；image / render / core-v2 / 3d 四包 `tsc` + ui `vue-tsc` + image 与 ui `vite build` 全通过。本轮新增 `imageContentRender`（SSR 真 HTML 锁&quot;平时铺满 / 裁剪时完整可见&quot;两态）。

## 现在立刻该做的一件事
- ✅ **图片节点去边框 + 清掉死配置 + 节点注册字段收成单一来源**（2026-09-13 第十轮，用户指定）：
  - 用户追问（原话）："我不明白 为什么图片插件会有边框?? 什么地方需要他？"。查明：边框**不是图片插件的**，它来自**共享外壳**（theme-default 的 BaseNode `.v2-card`，`borderWidth: 1px/zoom` + `border-style: solid`），本意是让卡片从画布背景上浮起来 + 承载选中态/非法连接的边框高亮 —— 所有节点类型共用，v1 也是同一个壳（`custom-node-card` 同样带 1px 边框），所以这 1px 是从 v1 继承来的，不是本轮重构引入。
  - **图片节点去掉边框**：图片是**内容铺满整张卡**的类型，那圈边框对它没有分层价值、只会变成内容边缘多余的一圈缝（用户一路在追的"图片边上还有一像素边距"就是它）。新增**类型级能力 `frameless`**（与 resizable/icon 同层，由类型自己声明，不让外壳猜节点类型），图片类型声明 `frameless: true`。**选中环不受影响**：环是 `.v2-card::after` 的 box-shadow，与边框互相独立 —— 这条是删边框最容易漏的回归，已单独写进契约测试。浏览器实测：图片节点边框 `0px`、3D 预览与图片对比仍 `1px`，图片四边间隙全部为 0（彻底贴边），选中环照常显示。
  - **删掉 6 个死配置**：`cornerRadius` / `showShadow` / `borderWidth` / `borderColor` / `blurOnLoad` / `lazyLoad` 在图片插件里声明过但**全仓无人读取** —— 设置界面里能看到、改了却毫无反应（比没有更糟：让设置面板显得可信，实际在骗人）。已整体删除，浏览器实测这 6 个 key 均读不到了。真要支持"图片可调边框/圆角"时再加，那时一次性把实现与测试一起补上。
  - **顺手修掉一个结构性隐患（本轮最重要的发现）**：给类型加字段时发现**同一份字段清单散落三处** —— `registerNodeType.ts` 的 `NodeTypeDef`、`capabilities.ts` 的 `NodeRegisterDef`、`types.ts` 里内联的 `register(def: {...})`。插件实际走 `ctx.nodes.register`（第二条路），而漏改 `types.ts` 那份会导致**类型检查报错、或字段被静默丢掉**。这次就真实踩到：`capabilities.ts` 的透传清单漏了 `frameless`，**单测全绿、浏览器里边框照旧**（测试覆盖了 `registerNodeType` 那条路，插件用的却是另一条）。已把 `types.ts` 的内联定义收成引用 `NodeRegisterDef`（单一来源），并在 `capabilities.test` 加"类型级能力逐字段透传"的测试钉住这条缝。
  - 测试：相关包共 **1106 条**全绿（内核 363 / 渲染 215 / 主题 91 / text 64 / image 148 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 23）；core-v2 / render / theme / image / text / 3d / compare 七包 `tsc` + ui `vue-tsc` 全通过。本轮新增 2 个测试文件 + 2 条用例：`cardFrame`（边框/圆角/选中环的取值规则，含"删边框别把选中环删没了"）、`capabilities.test` 的透传契约、`registerNodeType.test` 的 frameless 透传。

## 现在立刻该做的一件事
**四个节点的双态、尺寸行为、3D 快捷键与图片去边框已按用户第七~十轮要求落地，测试与类型检查全绿。** 下一步等用户目验后再定：目验入口 `cd packages/ui && pnpm dev`（text/image/3d-preview/image-compare 四个包都在装配清单里）。
本轮目验重点：① 文本节点默认看不到滚动条、双击进编辑后内容长了能滚且滚轮不缩放画布；② 3D 预览默认按住画面能拖节点、双击后能转视角、选中后 f 全屏 / r 重置 / Esc 逐层退出，且画面上不再有提醒与重置按钮；③ 连一张图后图片对比节点的宽度变得和那张图一样宽。
目验重点：选中节点时上下状态栏是否浮出且不撑高节点；图片上传后刷新是否还在；裁剪确认后是否原地替换并可撤销；文本加粗/字号/对齐是否生效且可撤销；3D 预览连一张图后能否拖拽转向；图片对比连两张图后分割线能否拖动。

## 验证命令（每次改完跑，测试是唯一裁判）
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run            # 测试全绿才前进
node ../../node_modules/typescript/bin/tsc --noEmit   # 类型干净
pnpm dev                                               # 起 vite 看画面
```

## 关键契约锚点（动手前读对应文档，不许自己发明接口）
- 执行剧本/里程碑/验收：`docs/plan/canvas-core-v2-runbook.md`
- ctx 内核 API 契约(定稿)：`docs/plan/canvas-core-v2-api.md`
- **核心节点件行为契约金标准(CustomNode/BaseNode/MovingHandle/NodeToolbar/ResizeHandle/CustomEdge,禁止改坏)**：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`
- 架构：`docs/plan/canvas-core-v2-architecture.md` / 依赖图 owner：`canvas-core-v2-depmap.md`
- 决策记录：`docs/adr/0001-canvas-core-v2-plugin-kernel.md`

## 铁律(每条都要守)
1. 测试是唯一裁判(亲眼看 runner 全绿)；浏览器画面只是演示，能跑/能恢复必须有无头测试兜底。
2. 契约不自己发明(只按上面锚点实现/消费；要改契约先改文档)。
3. 一个文件只归一个 owner；没列进当前闭环的东西(见红线)不做。
4. Do not change the tests(除非明确要先改测试)。
5. 卡住就停下(改法>2 次失败 → 用新信息重写该步 spec 或上报)，不脑补不无限重试。
6. 每步绿了就原子 commit，suite 全绿才进下一步。
7. 高危模块(内核/save/连接/核心节点件)动前先确认测试网在且绿。
8. 架构决策/接口契约/依赖排序/集成验证/评审关卡留在主 agent，不下发给并行子代理。

---
*本文件由主 agent 维护。里程碑推进时更新"当前进度/下一步"两节。*
