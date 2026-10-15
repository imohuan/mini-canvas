# AGENTS.md — mini-canvas 项目开工入口

> 在本项目里做任何事之前，**先读 `docs/STATUS.md`**（项目指挥中心：进度、验证命令、契约锚点）。
> 要动架构/分层/注册机制/加扩展点时，读 `docs/design/core-layers-and-registry.md`（终态设计与迁移步骤）。

## 当前主线

**三层包结构**（v2 现行架构，`packages/canvas-core-v2` 已删除）：

```
@mini-canvas/kernel         纯插件框架（装载/依赖/事件/作用域回收/注册表），零画布概念、零 Vue
@mini-canvas/canvas-data    数据层 + 画布语义（nodeStore/edgeStore/graph/save/history/selection + 注册表/连接校验/建节点）
@mini-canvas/canvas-render  渲染层（VueFlow/DOM/令牌 + nodeLayout/viewport）
@mini-canvas/canvas-base    插件作者的薄入口（重导出 kernel + canvas-data 类型）
@mini-canvas/ui             成品应用出口（一行 CanvasHost 出画布）
packages/plugins/*          插件库（24 个）
packages/cloud-server       自托管云端（KV + 资源 + 静态托管 + MCP 控制画布）
packages/mcp-server         AI 工具链后端（MCP/SSE + 生成任务）
```

依赖方向单向：`kernel ← canvas-data ← canvas-render ← plugins`。kernel 不依赖任何 @mini-canvas 包。

下一阶段主线见 `docs/design/core-layers-and-registry.md`：把「加新功能必须加服务」改成「往注册场里注册」。

## 红线

1. **不碰 v1**：根 `src/` 与 `packages/canvas-core`（老版宿主与老版内核）。
2. **核心节点件禁止改坏**：`packages/plugins/plugin-theme-default/src/components/` 下的
   `node/BaseNode.vue`、`node/MovingHandle.vue`、`node/BaseTitle.vue`、`edge/CustomEdge.vue`、
   `edge/ConnectionLine.vue`、`background/DefaultBackground.vue`。
   改动前先读行为契约金标准：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`
   （2026-09-17 已重建，六件 66 条不变量 / 27 条易碎点，全部带 file:line 锚点；
   其中 §9「端口区默认值双源漂移 86 vs 10」动端口几何前必须先对齐）。
   相关的现行规范见 `docs/规则/节点区域与连接线拖拽规范.md`。

## 验证命令（每个包各自跑；根目录没有统一 test 脚本）

```bash
pnpm -C packages/kernel test          # 196（步骤 6 后）
pnpm -C packages/canvas-data test     # 306（步骤 5 后）
pnpm -C packages/canvas-render test   # 333（步骤 4 后）
pnpm -C packages/ui test              # 27（整装/设置覆盖/插件装配）
pnpm -C packages/plugins/<插件名> test  # 单个插件

pnpm -C packages/canvas-render typecheck   # tsc --noEmit
pnpm -C packages/ui typecheck              # vue-tsc

pnpm -C packages/ui dev                    # 起画布应用看画面（:5288）
```

**测试是唯一裁判**：全绿才前进。（数字为 2026-09-17 实测基线，会随开发变动；以 `docs/STATUS.md` 为准。）

## 文件操作铁律（2026-10-16 事故后新增，必须遵守）

1. **编辑文件后立即 commit**：每完成一个文件的修改（或一组相关修改），立刻 `git add` + `git commit`。
   绝不允许把大量改动堆在工作区不提交 —— 未提交的改动一旦被 `git checkout` / `git restore` 破坏
   就**永久丢失**（2026-10-15 VideoContent.vue 帧图系统因 checkout 丢失，靠用户备份才恢复）。
2. **git checkout / git restore 是危险操作**：执行前必须确认目标文件的工作区改动已提交或已备份；
   对未提交改动的文件执行 checkout 前必须先 `git stash` 或 `git add + commit`。
3. **多轮实验后必提交**：调试/实验过程如果修改了源码，无论实验结论如何，结束时就地 commit
   （实验失败就 revert commit，不要留着工作区不提交）。
4. **用户提供的备份文件（如 `* copy.vue`）先提交再使用**。

## 写 UI 前必读

任何浮层/菜单/面板/弹窗，先读 `docs/design/ui-style-guide.md`（设计 token、组件数值、动效、a11y 硬性规则），不自造颜色/圆角/字号数值。

## 找文档

- 项目进度 / 当前该做什么：`docs/STATUS.md`
- 架构与分层设计（终态 + 迁移步骤 + 决策记录）：`docs/design/core-layers-and-registry.md`
- 插件作者教程（7 篇，照抄能跑）：`docs/plugin-dev/`
- 改插件身份（自带件 ⇄ 可装卸件）或插件面板里找不到某插件：`docs/规则/插件身份切换手册.md`
- 各包 API 手册（按现行包结构分层：kernel / canvas-data / canvas-render / plugins）：`docs/代码开发/00-总览与架构.md` 及其子目录
- 插件系统目标与验收：`docs/goal/plugin-system-goal.md`
- 架构决策记录：`docs/adr/`
