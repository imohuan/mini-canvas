# 10: 决定端口几何的唯一默认值

**What to build:** 维护者与产品负责人选定端口吸附区域的规范默认值和迁移语义，为后续独立行为修改提供明确基准。

**Blocked by:** None (decision can start immediately; any implementation is a separate follow-up)

**Status:** proposed

- [x] 对照宿主默认与主题配置，说明两条来源的实际生效路径和设置优先级
  （见 docs/plans/2026-09-27-port-zone-default-decision-brief.md：App.vue 传
  :handle-visual=ui.cfg.handle，CanvasHost 仅在未传时回落宿主默认；真浏览器实测成品走 10/0.55/0.8）。
- [ ] 负责人明确目标默认值及是否保留用户保存的覆盖值。
- [x] 决策记录端口宽度、高度比例、弧比例对命中范围和可见端口的影响
  （命中范围、可见外观、存量设置、多选批量端口、调试叠加五个影响面已逐条列出）。
- [x] 明确后续行为实现所需的核心节点契约检查、单测和浏览器场景
  （核心节点契约必读、portZoneGeometry 纯函数断言、拖线命中/缩放跟手/调试叠加三组浏览器场景）。
- [x] 本票只记录选择，不顺手修改交互几何或用户存档。
