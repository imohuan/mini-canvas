# 吸附命中归属重构 —— 实施与结果

## 目标（原）
把"拖线时悬停到哪个节点的哪侧吸附区"判定，从 render 后端复制几何(computeSnapZones/bandRectForSide)
改由**真实渲染 DOM/UI** 判定；render 只负责业务校验 + mouseup 落边，不再复刻吸附几何。

## 关键认知
- mouseup 是全局事件 → 必须 render 最外层 document 捕获（保留现状），是"何时建边"唯一权威。
- 吸附命中本质是"鼠标在哪个可点击吸附区上"——真实 DOM 就是唯一真相，render 无需再算数学模型。
- VueFlow 拖线临时连接线 `.vue-flow__connection { pointer-events:none }` → 不挡 elementsFromPoint；节点在拖线时仍可被 DOM 命中。

## 最终采用机制（比"zone 逐元素 emit"更稳）
把"瞄准目标解析"放在 render 的拖线 document mousemove/mouseup（捕获，可靠时序）里，
用 **elementsFromPoint 探真实 DOM**：命中某节点 `.moving-handle-zone`/锚点 → side=input/output(snap)；
命中 `.v2-node` 卡片 → side=body。纯逻辑（方向/侧规整成 source→target 候选）抽到可单测的 connection/aim.ts。
> 不用 BaseNode/MovingHandle 逐 zone emit 上报的理由：body 与 port 相互覆盖、mouseleave 竞态难收干净，
> DOM 探针把"几何真相"与"时序(全局 mousemove)"合在一处，最稳、无复制几何。

## 改动清单（已落地）
1. `connection/aim.ts`(新)：Aim 类型 + 方向规整(forward/reverse)/候选/侧匹配纯函数。单测 aim.test.ts(9) 通过。
2. `host/domAim.ts`(新)：aimAtClient(clientX,Y,excludeId) 用 elementsFromPoint 探真实 DOM 返回 Aim。
3. `host/CanvasHost.vue`：
   - onDragMouseMove：flowPoint 照写 dragFlowPoint；hoverNode 改由 aimAtClient → aimToHoverFeedback(校验 valid/invalid+reason) 生成；删 liveNodeRects/resolveAtClient/decideDropFromHover/resolveFeedback 几何命中。
   - onDragMouseUp：松手点 aimAtClient → 方向匹配(aimAcceptsSide) → aimToCandidate → checkConnection → commitEdge。
   - aimToHoverFeedback/currentAim 辅助。仅 `@connect`(精确点 Handle)仍走 VueFlow 原生；commitEdge 幂等防双建。
4. `canvasHostCore.ts`：DEFAULT_HANDLE_VISUAL.portZoneWidth 0→86（修 latent bug：后端几何默认 0 使吸附带塌零；
   且 DOM 探针依赖端口 zone DOM 有实际宽度，86 才可命中）。原单测断言 86，改后即绿。
5. `plugin-theme-default/src/index.ts`：DEFAULT_THEME_HANDLE.portZoneWidth 0→86（对齐）。
6. `index.ts`：导出 connection/aim。

## 分工（答架构问题）
- 前端 UI 定义吸附区外观并渲染成真实可命中 DOM（MovingHandle zone / BaseNode 卡片）——吸附形状归属 UI。
- render 不再维护一套吸附带数学模型；只负责：解析 DOM 命中目标 → 业务校验(类型/容量/自连/重复) → mouseup 建边落数据。
- 对用户问题"为何日志没吸附/一直 body"的根因：后端几何带宽默认 0(width=0 hitTest 永不命中) → 只余 body。
  现已把命中改走真实 DOM，且端口 zone 默认宽 86 可命中。

## 验证
- canvas-render typecheck 通过；vitest 98 passed（含新 aim.test.ts 9）。
- plugin-theme-default typecheck 通过。
- 运行级手动校验（需浏览器/需 dev server，本机无法跑 UI）：
  - 拖 A.source → B 卡片 body：松手建边（日志 `→ A→B/body`）。
  - 拖 A.source → B 输入半圆吸附区：snap 命中（日志 `→ aim B/input`，松手 `A→B/snap`）。
  - 拖到空白松手：`→ 空白(松空)`。
