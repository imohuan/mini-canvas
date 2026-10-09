# Agent 队列 / 引导 / 后台对话 / 目标模式 —— 实施计划

- 日期：2026-10-08
- 类型：实施计划（对应设计：`docs/superpowers/specs/2026-10-08-agent-queue-and-goal-design.md`）
- 状态：**待评审**（设计通过后开工）
- 验证基线（2026-10-08 实测）：cloud-server **396** 全绿 + tsc 干净；plugin-agent **105** 全绿 + tsc 干净；ui **158** 全绿 + typecheck 干净

> 纪律：每完成一个 Task 跑它对应的测试；测试全绿才进入下一个 Task。
> 涉及红线的文件（`plugin-theme-default/src/components/` 六件核心节点件）**一律不碰**。
> 修改文件一律走 apply_patch；检索走 codegraph。

---

## 阶段 0：准备（半天）

### Task 0.1 建分支 + 基线

- 分支：`codex/agent-queue-goal`
- 跑三个包基线：`pnpm -C packages/cloud-server test`、`pnpm -C packages/plugins/plugin-agent test`、`pnpm -C packages/ui test`
- 记入 `docs/STATUS.md` 的「当前分支」段

### Task 0.2 抽公共的会话文件读写（为队列铺路）

- `sessionStore.ts` 增加 `patchQueue(canvasId, sessionId, mutator)`：复用现有原子写，
  在 **进程内串行队列** 上执行（同一会话的 queue 更新不并发）；`AgentSessionRecord` 加
  `queue?: QueueState` 字段（可选，老文件没有就视为空队列）。
- 类型定义 `QueueItem / QueueState` 放 `sessionStore.ts`（与 AgentTurn 同处，单一来源）。
- 测试：`sessionStore.queue.test.ts`（新增文件）：加/删/改/gate 流转、并发 patch 串行、老文件兼容。

**验证**：`pnpm -C packages/cloud-server test` 全绿。

---

## 阶段 1：后台对话（最重的基建）

### Task 1.1 SessionHub（每会话常驻事件通道）

- 新文件 `cloud-server/src/agent/sessionHub.ts`：
  - `events: {seq, ev}[]`（有上限裁剪）+ `subscribers: Set<(seq, ev) => void>`
  - `start(canvasId, sessionId, run: () => AsyncGenerator<AgentChatEvent>): Promise<void>`
    —— 后台消费生成器、append 事件、通知订阅者；`abort()` / `isRunning()`
  - `subscribe(since: number): { replay: ev[], unsubscribe } `
- 单测 `sessionHub.test.ts`：回放/续推/裁剪/订阅者断开不影响 run。

### Task 1.2 AgentRuntime 托管化

- `runtime.ts`：把 `run(...)` 的生成器主体保留，新增 `startRun(canvasId, input)`
  走 hub（不再接 HTTP signal）；`abort()` 与 hub.abort 对接。
- `runtime.run` 的调用方（agentSessions 路由）改为 `hub.start` + 订阅。
- 开关：`agentRunMode`（KV，默认 `background`）；`follow` 时保留旧的 onAbort-abort 行为。
- 测试：`agentRuntimeBackground.test.ts`：断开订阅不断 run；abort 仍能中止；开关切换两种行为。

### Task 1.3 断线重连端点

- `GET .../sessions/:id/stream?since=N`（新）：SSE 订阅 hub 并回放。
- `GET .../sessions/:id` 返回体加 `running`（已有）+ `runStartedAt`（新，界面判断"正在跑"的锚）。
- 测试：路由层 e2e（existing `agentMiddlewareE2E` 模式）：中途断开重连拿到缺口事件。

### Task 1.4 进度快照（部分文本）

- hub 在 `text/partial` 事件上维护"当前未完成块"的**快照**（每会话一份，内存），
  重连时随回放一起给（事件类型 `snapshot`）。
- 测试：重连后快照可复现"正在写的半段文字"。

**阶段 1 验证**：cloud-server 全绿 + tsc；真机：跑一轮中途刷新 → 轮不被打断、回来续流。

---

## 阶段 2：队列与调度（后端）

### Task 2.1 队列 CRUD + 状态机

- `cloud-server/src/agent/queue.ts`：纯函数状态机（add/update/remove/close/cancel-edit/
  pause/resume/claim）+ `tick(canvasId, sessionId)` 调度判定。
- 单测 `queueState.test.ts`：§3.3.1 的每条纪律（原子流转、不重复认领、编辑阻塞、暂停）。

### Task 2.2 队列路由

- `POST .../queue`（op: add/update/remove/close/cancel-edit/pause/resume）
- `POST .../queue/:itemId/steer`（引导）
- `GET .../sessions/:id` 返回体加 `queue`。
- 测试 `agentQueueRoute.test.ts`：每个 op 的行为 + 落盘 + 事件推送。

### Task 2.3 调度接入

- 一轮结束（runtime 的 finally）→ `tick`；队列变更 → `tick`；暂停/启动 → `tick`。
- 空闲时（没人订）也能自动发：`tick` 走 `hub.start`（事件仍进 hub，页面连上就回放）。
- 对账：进程启动时扫一遍会话文件，`sending` 条目查转录判定 sent/退回 queued。
- 测试：`queueScheduler.test.ts`（假 run）+ 重启对账测试。

### Task 2.4 引导修正（补转录）

- steer 分支（`runtime.ts:272`）：补 `store.appendTurn`（user 回合）——修
  "引导消息刷新后消失"的洞；转录里标记 `steered: true`（界面可加"引导"小标）。
- 测试：`agentSteerPersist.test.ts`。

### Task 2.5 通知事件

- hub 事件加 `round_done`（一轮结束）与 `queue_idle`（队列空且空闲）。
- 测试：事件的触发时机（含"队列跑完最后一条"）。

**阶段 2 验证**：cloud-server 全绿 + tsc。

---

## 阶段 3：目标模式（后端）

### Task 3.1 goal 安装器

- `config.ts`（或新 `goal.ts`）：`ensureGoalInstalled()` —— 用 SDK 的 `libraryPlugin('goal')`
  + `installHook`，**manifest 原样安装**，仅给 `user_prompt` 补 `trigger:"host"` 一道保险
  （设计 §3.4.1 已实测当前 SDK 行为下无影响；`stop` 命令照装照用）。
- 幂等：已装且版本一致则跳过；版本升级时重装。
- 测试：`goalInstall.test.ts`：hooks.json 内容（trigger 补齐、stop 保留）、幂等、不覆盖其它 hook。

### Task 3.2 目标启动 + 轮次循环

- `cloud-server/src/agent/goal.ts`：
  - `startGoal(canvasId, sessionId, objective, budget)`：runUserPromptHook + 发起第 1 轮 run；
    **之后交给 SDK 原装自动连播**（stop hook 照用），宿主只在轮次边界观察状态、推 `goal_state`
  - `readGoal / updateGoal`（读/写 GOAL.json；改 budget 两种模式换算）
  - `pauseGoal`：把 `GOAL.json` 改名挪走（`.paused`）+ 记 `goalPaused` 标记 +
    轮结束后守住文件缺席（复活就再挪走，保留最新内容）
  - `resumeGoal`：文件改回原名 + 清标记 + 踢一脚（执行官方 `stop.mjs` 拿 continue 文本，
    作为下一轮输入发起 run）
  - Trace 定位：复用 `traceFork.ts` 的按 sessionId 查找逻辑（抽公共函数）
- 测试：`goalPauseResume.test.ts`（假文件系统 + 假脚本）：暂停后不多跑一轮、文件复活被守住、
  启动踢一脚、暂停时无文件降级为清标记。

### Task 3.3 目标路由 + 状态事件

- `POST .../goal`：`{op:'update', budget|deltaBudget|objective}` / `{op:'pause'|'resume'}`
- `GET .../sessions/:id` 返回体加 `goal`（读 GOAL.json + paused 标记）
- SSE 事件 `goal_state`（每轮更新后推）
- 测试：`agentGoalRoute.test.ts`

### Task 3.4 目标与队列/引导的交互

- 队列条目带 `goal` ⇒ 轮到时走 startGoal；目标 paused/running 时 tick 的判定；
- 引导插进目标当前轮（steer 通道不变）。
- 测试：§3.7 的特殊情况表逐条。

**阶段 3 验证**：cloud-server 全绿 + tsc；真机跑一次真目标（需要真模型）。

---

## 阶段 4：前端（plugin-agent）

### Task 4.1 队列视图模型 + API

- `agentApi.ts`：queue/goal/stream 的四个方法 + SSE 解析沿用。
- `sessionModel.ts`（或新 `queueModel.ts`）：队列列表状态、编辑阻塞、暂停中状态。
- 测试：`queueModel.test.ts`。

### Task 4.2 发送按钮状态矩阵

- `AgentConversation.vue`：按钮判定改为「有内容 ⇒ 发送；空 + running ⇒ 终止；空 + 空闲 ⇒ 禁用」。
- `agentService.send`：不再丢弃 running 期间的消息 ⇒ 走队列（未开「后台对话」时也成立）。
- 测试：`sendButtonStates.test.ts`（真编译组件 + 内存渲染器，照 `toolViewImagePreview.test.ts` 的做法）。

### Task 4.3 队列列表 UI

- 列表（80% 宽、贴输入框、行 28px、缩略图 16×16、引导/删除/⋯、⋯ 菜单两项）。
- 右侧按钮列（滚动到底部 + 暂停/启动，上下布局）；原 `.ac-to-bottom` 位置迁移。
- 测试：渲染 + 交互（点引导/删除/编辑/暂停）。

### Task 4.4 编辑阻塞 + 回填

- 点编辑 → 队列条目 editing + 文本/图片回填输入框（复用 `editIntoComposer`）；
- 发送 → update 原位替换；取消 → 回 queued。
- 测试：编辑不换位、取消回原位。

### Task 4.5 目标 UI

- `+` 菜单三项；目标标记（`🎯 … · 预算 50k` + ✎ + ✕）；预算弹框（两种模式）。
- 运行中目标状态条（`第 3 轮 · 12.3k / 50k` + 暂停/启动按钮 + 编辑）。
- 测试：`goalUi.test.ts`。

### Task 4.6 通知接通

- 完成/队列跑完事件的页面处理：`new Notification` + 声音（开关读 KV，从设置弹窗拿）。
- 测试：事件到通知的调用（stub Notification）。

### Task 4.7 流重连（前端）

- 页面加载/刷新时：GET 会话（含 running）→ 若 running 则 `stream?since=lastSeq` 接上；
  处理 `snapshot`（半段文字）。
- 测试：`reconnect.test.ts`（数据层）。

**阶段 4 验证**：plugin-agent 全绿 + tsc。

---

## 阶段 5：设置弹窗（ui 包）

### Task 5.1 三个设置项

- `ModalsArea.vue`：第一组加「后台对话」（默认开）、「目标设置」（默认预算）；
  「浏览器通知 / 通知声音」接真（存 KV + 页面消费）。
- 测试：`ui` 里设置读写测试（KV 路径、默认值）。

**验证**：`pnpm -C packages/ui test` 全绿 + typecheck。

---

## 阶段 6：联调与验收

### Task 6.1 e2e 更新

- `packages/ui/e2e/agent-e2e.mjs` 既有断言适配（`.ac-send.is-running` 语义变化等）。

### Task 6.2 真机验收（逐条对 G1–G15）

按设计 §5.2 的清单执行（Chrome MCP 走 5288）：
1. 跑着发消息 → 按钮仍是发送、消息进队列、缩略图；2. 编辑第 1 条保持位置 + 阻塞；
3. 引导：像直接发送、实际插队；4. 刷新不断流、队列/暂停/编辑状态保留；
5. 目标：+`选择目标`不弹框 → 轮次推进 → 编辑预算下一轮生效；6. 目标暂停/启动；
7. 通知两条时机；8. 两个标签页不重复发送。

### Task 6.3 回归

- 全包测试：cloud-server / plugin-agent / ui（+ 受影响的 canvas-render 若动到）。
- 既有探针：`asset-tree-shared-check.mjs` 等与本次无关的保持绿。

### Task 6.4 收尾

- `docs/STATUS.md` 追记（改了哪些、真机证据、测试数字）。
- 若设计文档有偏离：回写 `docs/superpowers/specs/2026-10-08-agent-queue-and-goal-design.md` 的「实现偏差」小节。

---

## 顺序与依赖（一图）

```
0.2 存储
 └─► 1.1 SessionHub ─► 1.2 托管化 ─► 1.3 重连端点 ─► 1.4 快照
      └─► 2.1 状态机 ─► 2.2 队列路由 ─► 2.3 调度 ─► 2.4 引导补转录 ─► 2.5 通知事件
           └─► 3.1 安装器 ─► 3.2 目标循环 ─► 3.3 目标路由 ─► 3.4 交互
                └─► 4.x 前端 ─► 5.x 设置 ─► 6.x 联调
```

**并行机会**：3.1 安装器与 2.x 无依赖，可并行做；4.1 视图模型可在 2.2 接口定稿后先行。

---

## 预估（按顺序串行）

| 阶段 | 规模 |
|---|---|
| 0 准备 | 小 |
| 1 后台对话 | **大**（本次最重） |
| 2 队列 | 中大 |
| 3 目标 | 中大 |
| 4 前端 | 中大 |
| 5 设置 | 小 |
| 6 联调 | 中 |
