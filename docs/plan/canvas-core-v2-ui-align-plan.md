# v2 对齐主项目 UI（已完成，2026-09-04）

> 状态：**已交付并验证**。金标准：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`
> 分支 feat/cordis-plugin-system。目的：把 v2 demo 的节点/连线 UI 从"M2 最小壳 + VueFlow 默认边"对齐到主项目水准。

## ✅ 交付（3 个原子 commit）
- `8d8226d` **批次A CustomEdge** — `src/components/{edgeGeometry,edgeContext,CustomEdge}.vue` + 14 单测。
  自定义边：bezier/straight/step/smoothstep 路径、默认淡线、选中/相连/临时跑流光(辉光+热斑, dash24/76, ef-dash1.2s+ef-breathe1.6s)、箭头、热区(sw12)、双击剪切钮。edgeContext 注入解耦 v1 store。demo 接 edgeTypes.custom，首启 seed 加 text→image 示例边。
- `2146ded` **批次B BaseNode 满血外壳** — `src/components/BaseNode.vue`。
  反向缩放标题条(scale=1/max(zoom,0.5), ResizeObserver 实测卡宽)、标题就地重命名(双击/F2→input,Enter/blur 提交,Esc 取消)、选中环(蓝边+2px 环)、hover 端口、LOD(<0.4)。`nodeRegistryKey` 增 NODE_WRITE_KEY 注入写回；demo 提供写回(改 nodeStore+落盘+整体替换 nodes 触发 VueFlow 重渲染)。
- `5caa550` **批次C MovingHandle** — `src/components/MovingHandle.vue`。
  浮动圆球端口：真实 VueFlow Handle 锚点 + 半圆 zone + 圆球浮出跟随(cursorGap/overlap/rAF/disabled 清理/180ms 归位淡出)。尺寸对齐 contract §0(radius86/rest36/gap24/btn32/overlap16)。BaseNode 替换原生 Handle。

## 验证
- vitest **97 全绿**（83 原 + 14 edgeGeometry），tsc 干净。
- 浏览器(localhost:5200)逐项实测：CustomEdge 默认淡线/选中流光；BaseNode 标题反缩/选中蓝环/双击重命名即时生效并持久化(改 data.label)；MovingHandle 圆球 mouseenter 浮出跟随(scale1.06)/mouseleave 归位 220ms 淡出。
- demo 原闭环(增删/撤销/编辑文本/右键/刷新 + 正文双击编辑 vs 标题双击不冲突)不回退。

## 遗留（后续 M6 扩展，本次明确未做）
- 拖线吸附 / 连接 3D 反馈 / 无效连接 tooltip（v1 useCanvasConnection UI 交互段）——依赖真实指针拖拽，chrome-devtools 合成 pointer isTrusted=false VueFlow 不响应（工具限制）。
- NodeToolbar / ResizeHandle / CustomNode 错误边界完整版、更多节点类型(视频/全景/图片对比)、云同步多 view、性能浮层。
