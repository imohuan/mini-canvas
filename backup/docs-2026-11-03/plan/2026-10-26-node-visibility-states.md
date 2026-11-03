# 节点可见状态（visible / culled / culled-linked）——连线不随剔除消失

日期：2026-10-26。用户口径：节点可以不显示，但连线必须保持；且希望把"节点该画到什么程度"
做成节点状态，BaseNode（默认主题壳）按状态自由选择绘制方式。

## 背景

2026-10-15 上线的可见剔除走 VueFlow `hidden` 标记路线：视口（含 300px 缓冲带）外的节点
hidden=true，VueFlow NodeWrapper render null，不产出 DOM。当时只盯着节点性能，漏了连线：
VueFlow EdgeWrapper 源码（vue-flow-core.mjs:8892）写死
`if (edge.hidden || sourceNode.hidden || targetNode.hidden) return null` —— 任一端被剔除，
这条边就整体不画。于是出现"画布内节点的连线凭空断掉"。

## 方案（用户选定：宿主下发状态，壳自选绘制）

1. **hidden 只做压缩档工具**（2026-10-26 当日二次演进）：基础方案是节点一律常驻
   （hidden 恒 false），性能回收靠壳的策略层剔除内容；随后用户要求壳也省
   （1000 节点/屏内 20 场景），新增设置 `cullCompactShells`（缺省开）——
   **纯 culled**（视口外且不在 linkedIds）节点 hidden=true 零 DOM，
   culled-linked 与 transient 绝不 hidden（否则跨内外连线被 VueFlow 连坐消失——
   本方案立项的原始 bug）。hidden 的安全边界由此从"全部禁用"收窄为"只许压无牵扯节点"。
2. **宿主下发状态，不掺决策**：CanvasHost 在灌渲染态时给每个节点打
   `data._cullState: 'visible' | 'culled' | 'culled-linked'`（transient **不下发**，
   壳读不到该字段即按 visible 全量处理——与"transient 永不剔除"语义等价且 data 更干净）。
   - visible：视口 + 缓冲带相交（判定逻辑不变，visibleCull.ts 纯函数复用）。
   - culled：视口外，且没有任何连线连着它。
   - culled-linked：视口外，但至少有一条连线连着它（另一端画内画外均可）。
   - transient：拖线菜单卡等临时节点，永不剔除（沿用 2026-10-16 规则）。
   - 分组父子沿用"零例外"：各按自身矩形判定，不特判。
3. **壳策略（plugin-theme-default 默认实现）**：
   - visible：全量绘制（现状行为，逐像素不变）。
   - culled-linked：骨架——标题条与 MovingHandle（真实 Handle 锚点）保留，
     内容段/控制栏/多选标记/区域条不挂载，卡片本体 visibility:hidden（占位、不可点）。
   - culled：同骨架（默认主题不再区分这两档的画法，区分留给自定义壳；
     但仍然常驻、保持量测与端口几何）。
   - transient：全量绘制。
   - 新增本插件设置项 `culledNodeRendering`（skeleton 骨架 / full 全量 / ghost 占位框），
     缺省 skeleton。ghost 档画一个可见的空心占位框（调试/大屏场景用）。

## 为什么不是另两条路

- 给屏外端点补"假锚点占位节点"：占位进出集合时连线端点会跳；连线点击/删除/吸附都要补
  "还原成真节点"逻辑，散落多处。
- 宿主 SVG 自绘被剔除端点的连线：要复刻 CustomEdge 的贝塞尔/流光/选中高亮/剪切钮，
  等于维护两套连线系统。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| canvas-render/src/host/canvasHostCore.ts | nodesFromStore：_cullState 注入（接受 linkedIds 与 compactShells）；hidden 仅用于压缩档纯 culled |
| canvas-render/src/host/visibleCull.ts | 头注更新（hidden 路线退役原因） |
| canvas-render/src/host/CanvasHost.vue | 计算 linkedIds（edgeStore 建邻接表）；刷新时机沿用；去掉 hidden 旧注释 |
| canvas-render/src/host/CanvasSurface.vue | renderCtx 增补 nodeVisibility 说明（壳经 props.data 消费） |
| canvas-render/src/contracts/canvasInteractionSettings.ts | visibleCullEnabled 文案改为"视口外节点降级绘制" |
| plugin-theme-default/src/index.ts | Config 新增 culledNodeRendering（默认 skeleton） |
| plugin-theme-default/src/components/node/BaseNode.vue | 按 _cullState + 配置选择绘制；骨架 CSS |
| 测试 | canvasHostCore.test.ts / visibleCull.test.ts 改写 hidden 断言为 _cullState；新增 linked 判定、设置三档、transient 用例 |

## 验收

1. 画布内节点的连线，即使另一端在画布外也完整显示，端点锚在真实端口上。
2. 平移/缩放视口，剔除集合变化时连线不闪断（节点常驻，几何连续）。
3. 设置面板"只渲染可见节点"文案与行为一致；culledNodeRendering 三档切换即时生效。
4. 性能不回退：剔除态不挂载内容组件（重组件不再创建），量测/拖拽/多选/分组行为不变。
5. 包内 vitest 全绿（canvas-render / plugin-theme-default），typecheck 干净。

## DOM 审计（2026-10-26 真机 Chromium 实测，回答"DOM 为什么还在"）

此前 hidden 路线的真实行为：hidden=true 时 VueFlow NodeWrapper **render null，节点壳 DOM
整个消失**（不是 display:none）——用户看到的"DOM 还在"不是旧方案残留。改造后节点常驻，
DOM 分层如下（同一画布实测）：

| 层 | culled 节点 | visible 节点 |
| --- | --- | --- |
| VueFlow 内部 store 数据记录 | 有（连线解析必需） | 有 |
| .vue-flow__node 壳元素 | 有（保连线端点几何） | 有 |
| .v2-node 节点壳组件实例 | 有（标题/锚点载体） | 有 |
| .v2-card 卡片盒子 | 有，visibility:hidden 隐身占位 | 可见 |
| 内容组件（img/text/video 等） | **无（v-if 摘除）** | 有 |
| 节点子树 DOM 元素数（实测） | **8 个** | **24 个** |

即降级把"渲染成本大头"（内容组件树，本例 24→8，砍掉 2/3）真正摘掉了；
留下的壳是连线正确性与滚回视野零闪变的最小集合。VueFlow 把节点记录留在
内部 store 与"DOM 渲染了它"是两回事 —— store 记录只是 JS 对象，不进渲染树。
