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
### 本轮：多选插件的框选失效与群组框双框错位（用户指定，2026-09-14）
- 用户报的两个缺陷（原话）：
  ① 「shift + 左键 在画布中框选的时候 框选完成之后并没有真实的框选，也就是操作完成之后没有任何选中状况，只有通过 Ctrl 一个一个加选才有效」；
  ② 「框选之后你的UI 存在异常，2个框竟然有重合」，并给出两框的定义 —— 「小框 就是根据选中节点计算的最小 rect 框（不包含标题）；大框 是根据一个固定的padding 进行的（这个请写在插件的config配置中）；你的小框和大框颜色和样式（比如使用实现还是虚线， 线框宽度，颜色等）写在config 配置中」。
- **缺陷①根因（浏览器实测定位，非猜）**：框选期间插件确实把命中节点写进了内核 selection（CDP 埋点可见逐帧写入 空→68→62,64,68 … 一路累加），但**松手后浏览器还会补一个 click 事件**，宿主的 onPaneClick 语义是「点空白 = 清空选中」（selectionInteractions.clickPane），于是刚框出的选中被这一下 click 全清掉 —— 用户看到的等价于「框选不生效」。Ctrl 逐个点选不走 pane click，所以看起来只有它有效。修法对齐老版 MultiSelectPlugin：框选真的发生（超过 4px 阈值）就给下一次 pane click 打「要吞掉」的标记，落点在画布空白时于捕获阶段 stopPropagation。两个坑一并堵上：**标记必须在新的 pointerdown 作废**（松手点落在节点上时 VueFlow 不派发 pane click，标记会留着误吞用户下一次真实点击）；**没拖动不算框选**（否则 Shift 点空白清空选中会失效）。判定抽成纯逻辑 boxSelectGuard.ts 的 BoxSelectClickGuard（零 DOM 可单测）。
- **缺陷②根因**：内框的 width/height 被写成了**外框**的尺寸（只有 left/top 用了 padding）。外框 = 并集 + padding、内框位置 = padding、内框大小却 = 外框 —— 于是内框被推到右下且比外框还大，两框交叉错位。新几何一次算清：multiSelectEngine.computeSelectionFrameGeometry 返回 { outer, inner, innerOffset }，其中 **内框尺寸恒等于节点并集**（不掺 padding）、只由 padding 决定它落在何处。另把内框从「外框的子元素」改成**兄弟节点** —— 嵌在里面时外框线宽配成 0 会把内框一起带走（新加的渲染契约测试当场抓到这条连坐）。
- **外观与间距全部进 Config**（用户要求）：新增 multiSelectConfig.ts，分组 `布局/多选` 共 **13 项** —— 左右/上/下三个内缩，以及内外两框各自的**颜色 / 线型（实线·虚线·点线）/ 线宽 / 圆角 / 填充%**。key 一律加 multiSelectFrame 前缀（settings key 是全局平面命名、先声明者独占，裸 color/paddingX 会被静默丢弃）。线宽与圆角按 1/zoom 反向缩放，与 cardFrame.ts 同约定 —— 配置值的含义恒为「你屏幕上看到的粗细」。改动经 settings.onChange 实时生效，无需重载画布。
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
