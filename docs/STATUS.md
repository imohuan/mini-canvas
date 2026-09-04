# mini-canvas 项目指挥入口（每次开工先读这里）

> **我是项目的"当前该干什么"入口。任何 AI / 会话在本项目干活前，先读本文件确认进度与下一步，再读 `docs/plan/canvas-core-v2-runbook.md` 拿执行剧本。**

## 当前主线（2026-09-04）：canvas-core-v2 重构 · 开发测试期最小闭环
目标：把旧画布(180 文件, `packages/canvas-core/src`)收敛成自研 Cordis 内核(`packages/canvas-core-v2`)，先做出"text + 最简 image 两节点、能拖能连能删、起 vite 看到、刷新不丢"的最小闭环。**红线：不碰 `src/`(老版宿主)，不把 M6 复杂件(image 裁剪/蒙版/25个交互插件/云)带进当前闭环。**

## 当前进度（哪个里程碑）
- ✅ M0：M1 内核(Scope/Context/topo) + tracer bullet 全链 demo —— 68 测试绿
- ✅ runbook 修订 + 核心节点件行为契约金标准已产出(见下方契约锚点)
- ✅ **M1(浏览器)最小闭环骨架**：vite + localStorageAdapter + image 插件 + NodeStore.removeNode + CanvasDemo
- ✅ **M2：NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot** —— core/registry(NodeRegistry 纯逻辑无 Vue) + nodeRenderer 解析 + components/BaseNode.vue
- ✅ **M3：命令/删除收敛** —— Selection/History/CommandRegistry/NodeFactory + command:delete/create-node/undo/redo + CanvasDemo 全走命令 + 最小右键菜单
- ✅ **M4：Save 层完整 + key 规范 + 生命周期 flush + 契约测试网** —— keys.ts(SAVE_TYPES/scopedKey) + browserFlush(visibilitychange/pagehide) + saveContract.test(9 例四类互不干扰/切 adapter/落盘边界) —— 68 测试绿
- ▶️ **下一步 = M5：连接内核（加固）**（runbook 第五刀 ★）—— 把 v1 useCanvasConnection(1300行)+ConnectionValidator 的拖线校验/环检测/去重/吸附**原样吸收**成 v2 连接服务 + 声明式 inputs/accepts/limit；用 test-only 可连节点验收，normalizeConnection 契约测试锁死
- ⏳ M6(另开任务)

## 现在立刻该做的一件事
**做 M5**：先读 `docs/plan/canvas-core-v2-api.md` §四(声明式 inputs/accepts/limit) + ADR-0001 行动项 3 + v1 `packages/canvas-core/src/composables/useCanvasConnection.ts`(1300 行)与 ConnectionValidator 的 canonical 逻辑，把严格校验**原样吸收**成 v2 连接服务(normalizeConnection 环检测/去重/吸附)，再写**契约测试**锁死 v1 规则。验收：连接测试全绿；用 test-only 可连节点验证声明式约束，不拿未迁 image/panorama 验收。

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
