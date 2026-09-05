# AGENTS.md — mini-canvas 项目开工入口

> 在本项目里做任何事之前，**先读 `docs/STATUS.md`**。它是项目的指挥中心：当前主线、进度、**现在该做什么**、验证命令、契约锚点。
> 要动手实现时再读 `docs/plan/canvas-core-v2-runbook.md`（执行剧本）。

快速要点：
- 当前主线 = canvas-core-v2 重构(开发测试期最小闭环)。**红线：不碰 `src/`(老版宿主)**。
- 核心节点件(CustomEdge/BaseNode/MovingHandle/NodeToolbar/ResizeHandle/CustomNode)**禁止改坏**，先读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`。
- 测试是唯一裁判：改完跑 `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run`，全绿才前进。
- 写任何浮层/菜单/面板/弹窗等 UI 前，先读并遵循 `docs/design/ui-style-guide.md`（设计 token、组件数值、动效、a11y 硬性规则），不自造颜色/圆角/字号数值。
