# plugin-group

## 一句话

分组容器：建组/解组、拖拽归组、组内相对坐标、上控制栏。它同时注册 group 节点类型、上架 group 服务、维护 settings 键，是本组里职责最重的插件。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-group |
| 身份 | builtin |
| 源码文件 | 7 个（plugin 580 行 / engine 290 行 / 3 个 .vue / index / env.d.ts） |
| 测试文件 | 4 个，60 个用例 |
| 包依赖的其他插件 | 无（package.json 只有 canvas-base / canvas-data / canvas-render） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Service / Context / ConfigSchema | 是 | src/groupPlugin.ts:15 |
| canvas-data | 类型 DocService / SelectionService | 是 | 同上:16 |
| canvas-render | 仅类型（注释明确不能 runtime import） | 是 | 同上:17-19 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 代码级 import，但有多条 L2/L3 级数据契约。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get，transaction/updateNodes/updateNode/childNodesOf/subscribe | 必需 | src/groupPlugin.ts:471、513-514、532-533、573 |
| selection | inject + get，set | 必需 | 同上:471、513、532 |
| nodeLayout | inject + get，getNodeRect/getAllRects/absolutePosition | 必需 | 同上:471、139、210-228、295、342 |
| settings | tryGet，groupPadding* 四键 | 可选 | 同上:197-204 |
| group 服务 | ctx.inject('group', GroupService) | 对外提供 | 同上:129 |
| 节点类型 | nodes.register({ type: 'group' }) | 对外提供 | 同上:478-497 |
| 命令 | group:create(ctrl+g) / group:ungroup(ctrl+shift+g) | — | 同上:508-539 |
| 渲染事件 | 本地复制 'canvas:node:drag-end' 常量并 ctx.on | — | 同上:43、541-547 |
| overlay 槽 | order 35 | — | 同上:501-506 |

跨插件契约清单：

1. 类型名 group 与 auto-layout 共享（src/groupEngine.ts:22；packages/plugins/plugin-auto-layout/src/autoLayoutPlugin.ts:31、groupHierarchy.ts:48），两边各写一份字符串。
2. 渲染事件名拷了一份本地常量（src/groupPlugin.ts:42-43），注释说“避免 runtime 依赖渲染层”。这避免了包依赖，但事件名一旦在 canvas-render 改名，group 会静默不再归组，且没有编译错误。
3. group:create 被 multi-select 的上控制栏按命令 id 调用（packages/plugins/plugin-multi-select/src/SelectionGroupToolbar.vue:37-43）。这是跨插件的命令 id 契约；卸载 group 后按钮仍在，点击静默无操作（tryGet('command') 成功、execute 未注册命令返回 undefined，见 packages/kernel/src/command.ts:144-149）。
4. group 服务被宿主 UI 用来解组（packages/ui/src/composables/ui.ts:2212-2219），未装时提示“分组插件未启用”。
5. recalculateBounds 的注释写明“供 auto-layout 布局后调用收拢”（src/groupPlugin.ts:108-112），但 v2 的 auto-layout 实际自己算 groupFrames（packages/plugins/plugin-auto-layout/src/autoLayoutPlugin.ts:250-277），该 API 在 v2 没有生产调用方，只有 group 自己的测试 groupPlugin.test.ts:263-273。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| 本地事件名常量 canvas:node:drag-end | 订阅拖拽结束 | 高，重复定义 | src/groupPlugin.ts:43 |
| document / window / localStorage | 无 | 无 | 本包 src 检索为空（组件内也无） |
| CSS 类 ntp-root / v2-slot | 复用主题布局 | 中 | src/GroupTopToolbar.vue:70 |

## 内部职责与风险

580 行入口 + 290 行引擎 + 三个组件。引擎职责清楚（几何、坐标、归组决策）；入口承担服务、节点类型、命令、事件订阅、旧数据迁移。旧数据迁移 backfillLegacyGroupNames 会订阅 doc 的 replace 并在插件 apply 时立即跑一次（src/groupPlugin.ts:561-576），这是运行期写数据的行为：装插件即改存量画布（把 label=='' 的组补名）。属于安装副作用，需要在插件说明里提示。

嵌套上限写死 MAX_GROUP_DEPTH = 1（src/groupPlugin.ts:170），注释解释了原因（渲染层 z-index 只有两档）。这条与 canvas-render 的 z-index 实现强绑定：若渲染层改层级，这里必须同步，但没有共享常量。

## 单独装卸判断

可独立装卸，但卸载影响面大：multi-select 的打组按钮、宿主 UI 的解组菜单、auto-layout 对 group 类型的识别都会退化。装 group 自身不依赖其它插件；不装时 group 类型节点仍能被渲染为普通节点（如果存在旧数据），但归组行为消失。

## 建议改法

1. 最小改动：把 'canvas:node:drag-end' 改为从 canvas-render 的 RenderEvents 引类型常量，或把事件名收进 canvas-base 的公开常量，消除本地复制。
2. 把 GROUP_NODE_TYPE 与 padding 键收进公开常量，与 auto-layout 共用。
3. 验证：补一条“卸载 group 后 multi-select 打组按钮的禁用/提示”测试；现有 groupToolbarRender.test.ts 只测渲染，不测命令缺失。

## 待验证

- backfillLegacyGroupNames 在已有用户画布上是否会误改用户主动清空的标题；代码只认 label === ''，但旧版本确实写过空串，边界需要数据样本确认。
- 已确认渲染层层级常量集中在 packages/canvas-render/src/contracts/layers.ts；overlay 为 600（同文件:54-55），与 docs/canvas-render/z-index.md 的说明一致。分组垫底的具体档位仍需在 canvasHostCore 全文核对。

