# 04: 为 VueFlow 能力建立有就绪状态的渲染 facade

**What to build:** 插件能通过稳定、窄小的画布 Flow 接口完成视口、坐标、视觉节点更新和 DOM 查询，并能判断每项能力何时可用。

**Blocked by:** 03: 为作者上下文建立集中服务类型

**Status:** done (commit b88f4ad)

- [x] Render contract 不暴露原始 VueFlow 实例或 VueFlow 全量类型。
- [x] facade 区分等待实例、VueFlow 已接入、DOM 锚点已捕获和宿主已销毁等生命周期状态。
- [x] 未就绪或已销毁时调用会按契约返回 ready 状态或抛出明确错误，不通过默认坐标、坐标原样回传或空操作伪装成功。
- [x] DOM 锚点可后于 VueFlow 实例就绪；每项能力能单独报告 readiness，不要求 DOM-ready 才能做纯视口操作。
- [x] 提供插件当前需要的视口读取/控制、坐标换算、节点视觉更新和实例 DOM 查询能力。
- [x] 测试覆盖插件 apply 时、CanvasSurface 挂载后、DOM 就绪后和 host.stop 后的调用结果。
- [x] 旧 useCanvasRender 与旧注入令牌在本任务中继续可用。

实现说明：控制器是纯逻辑状态机（canvas-render/src/contracts/canvasFlowApi.ts，零 Vue/DOM，6 条单测）。
挂在 useCanvasRender().flow；插件 apply(ctx) 不接收它（那时 CanvasSurface 还没挂载）。
旧 viewport 服务与新 flow 共用同一份 VueFlow 后端适配对象，语义不再各写一遍。
