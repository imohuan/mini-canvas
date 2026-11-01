# Agent 消息队列、引导插队、后台对话与目标模式 —— 设计

- 日期：2026-10-08
- 类型：功能设计（属于 Agent 面板 / cloud-server 的一次扩展）
- 状态：**待评审**
- 相关文档：`docs/superpowers/specs/2026-10-01-agent-panel-ui-design.md`（面板 UI 基础）、`docs/design/agent-reference-and-modes.md`（引用标记）、`docs/design/ui-style-guide.md`（视觉规则）
- 涉及代码：`packages/plugins/plugin-agent/`（前端）、`packages/cloud-server/src/agent/`（后端运行时）、`packages/ui/src/components/areas/ModalsArea.vue`（设置弹窗）
- 底层能力来源：SDK `@prismshadow/penguin-core@0.2.13`（`Session.steer` / `Session.unsteer` / `Session.runUserPromptHook` / Trace）；目标插件 `@penguinharness/goal@0.2.13`

> 这份文档回答四个问题：
> 1. 正在跑的对话，刷新页面为什么会被打断、怎么改成不打断（**后台对话**）；
> 2. 用户排队的消息存在哪、怎么自动发、怎么插队、怎么不重复不脏（**消息队列 + 引导**）；
> 3. 目标（goal）怎么开、预算怎么改、暂停/启动怎么表现（**目标模式**）；
> 4. 上述三块的界面长什么样（**输入区布局与设置弹窗**）。

---

## 一、现状（改之前的真实行为，全部带锚点）

### 1.1 一轮对话的生命周期绑在浏览器连接上

发消息是 `POST .../sessions/:sessionId/messages`，**响应体本身就是 SSE 流**
（`packages/cloud-server/src/routes/agentSessions.ts:272`）。页面刷新 → 浏览器断开 → 服务端
`stream.onAbort(() => ac.abort())` 主动中止这一轮（`agentSessions.ts:287`，注释原文：
「浏览器关页面 / 断网：立刻中止这一轮，别让模型白跑」）。`AbortController` 的 signal 一路传给
`runtime.run` → `session.run(..., { signal })`（`runtime.ts:282/328`）。

**结论**：现在「后台对话」不存在。这一轮活着是因为页面活着。

### 1.2 正在跑时，用户再发一句会被直接丢弃

前端两处闸门：
- `agentService.send()` 第一行 `if ((!value && !pics.length) || state.running) return`（`agentService.ts:534`）
- `AgentConversation.submit()` 同样拦一遍（`AgentConversation.vue:402-403`）

后端其实有半个接缝：会话正在跑时新来的消息走 `session.steer()`（`runtime.ts:272-279`），
但**前端没有入口**，而且那个分支在写转录之前就 `return`（`runtime.ts:273` 早于 `:289`），
所以引导消息只进 SDK trace、**不进前端转录 → 刷新后界面上消失**。

### 1.3 SDK 提供的能力（已实测）

| 能力 | 签名 | 语义 | 证据 |
|---|---|---|---|
| 插队 | `steer(input: OmniMessage[]): boolean` | 把消息排进「下一次请求输入」，作为独立 `[user_steering]` 块投递；**不打断当前轮**；无任务在跑时返回 false | `penguin-core/dist/index.d.ts:3760`；实现 `index.js:9092-9096` |
| 撤回 | `unsteer(input): boolean` | 按**引用身份**（同一个数组对象）从队列里移除；已投递/已退出返回 false | `index.d.ts:3767`；`index.js:9106-9108` |
| 队列生命周期 | —— | `steeringQueue` 是**纯内存**，`run` 退出（含 abort）即清空，无任何落盘/恢复 | `index.js:9068-9076`；`index.d.ts:3758` |
| 目标启动 | `runUserPromptHook(name, prompt, extras?)` | 跑命名钩子包的 `user_prompt` 命令，返回 `{ context }` 由宿主紧跟用户消息发出（stamped `sender:"harness"`） | `index.d.ts:3706-3715` |
| 目标续跑 | `stop` 钩子返回 `decision:"continue"` + `input` | `session.run` 自动把 input 作为下一轮输入继续跑，直到没有 continue | `index.js:10688-10712`（run 内的循环） |

**关键事实**：SDK **没有任何**宿主自定义数据 API —— 没有 KV、没有 metadata/extras 字段、
`session_meta` 字段全固定、`Writer/TraceSink` 消息类型是封闭联合。宿主想持久化自己的东西，
只能存到自己的目录里（详见 §3.1）。

### 1.4 目标插件（goal）现状

`@penguinharness/goal@0.2.13` 已随 SDK 装进磁盘（`penguin-core` 的 dependencies），
但我实测：**cloud-server 一个字节都没接** —— `agent_state/hooks/` 是**空目录**，
`runUserPromptHook` 全仓零引用。

插件的两个脚本（已实测跑通 `start.mjs`）：
- `start.mjs`（`user_prompt`）：写 `<scratchpad>/GOAL.json`，返回第 1 轮的协议文本
  （`{objective, status:"active", budget, round:1, tokens_used:0}`）
- `stop.mjs`（`stop`）：**每轮结束重新读 GOAL.json**，判断
  `goal.budget > 0 && goal.tokens_used >= goal.budget`，未完成则 `decision:"continue"` + 下一轮文本

**预算可改的原因就在这里**：`stop.mjs` 每轮重读文件（`hooks/stop.mjs:45`），宿主改
`budget` 字段后，**下一轮**就按新值判。解析宽容（`lib.mjs:55`：`Number.isFinite`）。

### 1.5 设置弹窗现状

`packages/ui/src/components/areas/ModalsArea.vue:645` 起是「TV DIRECTOR 全局设置」
（`s.directorOpen`）。第一组卡片里已有「协作模式」（`:659-668`）。
第二组是「浏览器通知 / 通知声音」（`:686-706`）——**这两个是死开关**：
全仓搜 `new Notification` / `new Audio` **零命中**，点了只翻本地状态，什么也不发生。

### 1.6 队列类数据当前落在哪

宿主自己的每会话存储已经存在：`<root>/canvases/<canvasId>/agent/sessions/<sessionId>.json`
（`agentPaths.ts:56-67` 推导，`sessionStore.ts` 读写）。当前记录形状
`{ id, title, createdAt, updatedAt, provider, modelId, preview?, turns[] }`。
头部注释已说明它存在的理由：「SDK 的 resumeSession 恢复的是模型上下文，本文件给界面回放」。

---

## 二、总目标（用户口径，逐条）

| # | 要求 | 出处 |
|---|---|---|
| G1 | 输入框有内容时按钮是「发送」，空且正在跑时才是「终止」 | 用户第 1 条 |
| G2 | 跑着的时候发的消息进队列，输入框上方显示队列列表（贴输入框、宽 80%，图标 + 文本 + 右侧按钮） | 用户第 1、2 条 |
| G3 | 队列里编辑过的消息**保持原位置** | 用户第 1 条 |
| G4 | 「引导」= 表面上像直接发送，实际插队到下一次请求 | 用户第 1 条 |
| G5 | 目标：`+` 菜单可选目标，输入框开头加目标标记；预算可编辑（弹框） | 用户第 1 条 + 后续补充 |
| G6 | 刷新不打断正在跑的一轮，回到页面能继续看到流输出；设置里有「后台对话」开关（默认开） | 用户后续 |
| G7 | 编辑阻塞：有消息在编辑中时，队列停在原地等发送 | 用户后续 |
| G8 | 暂停/启动按钮（停止队列自动发送；可恢复） | 用户后续 |
| G9 | 「回到底部」+「暂停」两个按钮放到队列列表右侧，上下布局 | 用户后续 |
| G10 | 队列行显示图片缩略图（小，与文字等高） | 用户后续 |
| G11 | 通知接通：每轮完成弹一条 + 队列全部跑完再一条 | 用户后续 |
| G12 | `+` 菜单只有两项（**目标** / **上传文件**）；点「目标」直接用默认值加标签（**不弹框**），**点标签本身**才弹编辑框；默认配置放全局设置弹框（与「后台对话」同位置） | 用户后续（修正） |
| G13 | 目标运行中，点「引导」也直接插进目标的下一次请求 | 用户后续 |
| G14 | 目标支持「暂停」/「启动」 | 用户后续 |
| G15 | 不允许一条消息发两遍；不允许脏数据；考虑特殊情况 | 用户后续 |

---

## 三、设计

### 3.1 数据放哪（队列 + 目标状态）

**队列存宿主自己的会话文件** `sessions/<sessionId>.json`，新增一个 `queue` 字段
（不动 SDK、不碰 Trace）：

```jsonc
{
  "id": "session-...",
  "title": "...",
  "turns": [ ... ],
  // 新增：
  "queue": {
    "paused": false,
    "items": [
      {
        "id": "q-<ts>-<rand>",       // 宿主生成的唯一 id（去重/编辑/删除的锚点）
        "text": "……",                 // 与用户消息同一份文本（含 <ref …> 标记）
        "images": ["data:image/..."], // 可选，与消息体同款 data URL
        "goal": { "objective": "...", "budget": 50000 },  // 可选：这一条要以目标模式发出
        "state": "queued" | "editing" | "sent" | "cancelled",
        "createdAt": 1790980000000,
        "sentAt": 1790980100000       // 可选，发起时写入
      }
    ]
  }
}

```

**为什么是这里（而不是 SDK 的 scratchpad）**：
- 这是宿主自己的每会话存储，删除/迁移/备份完全自主（`sessionStore.ts` 头部注释）；
- 跟着画布走：删画布 = 删这个目录（`sessionStore.removeCanvas`）；
- SDK 的 scratchpad 官方注释是 `temporary/draft file directory`
  （`index.d.ts:298`）且承诺"随会话删除被清理"（`:306`），语义不属于宿主；
  模型自己也在那个目录里干活，宿主数据混进去容易被误删。

**目标状态**不在宿主文件里重存一份：**唯一真相是 `GOAL.json`**
（`<root>/agent/<projectId>/agents/<agentId>/scratchpad/<sessionId>/GOAL.json`，
SDK 的 `sessionScratchpadDir()` 已导出，路径公式 `index.d.ts:302-308`）。
宿主读它渲染状态、写它改预算/暂停。

### 3.2 后台对话（托管一轮的生命周期）

**改法**：把"跑一轮"从"响应的生命周期"里解耦出来，并把「一条会话的事件」改成常驻通道。

1. 进程内新增一个 **SessionHub**（`cloud-server/src/agent/sessionHub.ts`）：**每会话一个常驻通道**
   —— `events: AgentChatEvent[]`（本会话最近的累积，带自增 `seq`）+ `subscribers: Set`
   + `run: {status, abort?} | null`（当前有没有轮在跑）。
   「每会话常驻」是必须的：队列在**后台空闲时**也会自动起下一轮，那时没有正在跑的 run，
   事件也必须有人推给页面（否则界面不知道队列在动）。
2. 发消息不再"直接跑在响应里"，而是 `hub.start(canvasId, sessionId, input)`：
   后台把这一轮跑到底（服务端自己的 AbortController，**不受任何 HTTP 连接影响**），
   事件一边追加进 hub（seq++）、一边推给当前所有订阅者，同时按既有口径写转录。
3. `POST .../messages` 的响应变成**订阅这个 hub**（从 seq 0 回放已有事件再续推）；
   刷新/重开页面走 `GET .../stream?since=N` 接上（回放 N 之后的事件 + 续推）。
4. `stream.onAbort` 只取消"这条订阅"，**不再 abort 这一轮**。真正中止只有
   `POST .../abort`（用户点终止），或「后台对话」关闭时（见下）。
5. hub 的事件缓冲有上限（如最近 2000 条 / 500KB，超出裁剪最旧的）：重连只需要
   "够补上界面缺口"，不是全量日志（全量在转录里）。裁剪时保留一个 `droppedSeq`，
   前端发现缺得太多就以「GET 会话转录」重放一次再续（保底路径）。

**开关**：「后台对话」放设置弹窗（`ModalsArea.vue`，位置在「协作模式」下面）。
- 开（默认）：进行中的那一轮不受连接影响（上面第 1-5 点）；
- 关：恢复旧行为 —— 连接断开时 abort 这一轮。

开关存后台 KV（`/api/kv/config/agentRunMode`，与设置/主题同一条路，
`kv.ts:67-107`、前端 `appTheme.ts:36` 的先例），刷新后保持。

**进程重启**：跑着的一轮会断（SDK 的 run 是内存态）。重启后的对账见 §3.4。

### 3.3 队列与调度

#### 3.3.1 队列状态机（一条消息的一生）

```
            ┌──────────── send（空闲时）──────────────┐
            │                                          ▼
  [输入框] ──send（跑着时）──► queued ──scheduler──► sending ──► sent（从队列移除）
                               │  ▲                    │
                     编辑 ⟲     │  └──── 取消编辑 ──────┘
                               ▼
                            editing（阻塞队列）

  任意状态 ──删除──► （移除）
  queued ──关闭排队──► （移除 + 文本/图片回填输入框）
```

**纪律**（防重复 / 防脏数据，对应 G15）：
- 最终裁判只有一个：**后台调度器**。浏览器只发指令（加/删/改/引导/暂停/启动），
  两个标签页不会各发一遍。
- `queued → sending` 是**一次原子流转**（读文件 → 改状态 → 写文件，串行队列内完成），
  发起前再从队列里"认领"这一条；**已 sending 的不再被任何触发点取第二次**。
- 发起 = 先写 `state:"sending"` + `sentAt`；该轮结束、转录里能查到这条 user 回合，
  才把 `state:"sent"` 并**移除**。任何一步失败都不重复发（宁可留一条待人工确认，也不重发）。
- 重启对账：读转录当证据 —— 队列里 `sending` 的条目，若转录中已有同文本的 user 回合 ⇒ 标 `sent`
  并移除；没有 ⇒ 退回 `queued` 重新调度。

#### 3.3.2 调度规则（什么时候发下一条）

同时满足才发：
1. 该会话**空闲**（没有正在跑的轮）；
2. 队列**未暂停**（`paused: false`）；
3. 队头**不是 editing**。

触发点（三处都会调同一个 `tick`）：一轮结束、用户增删改队列、暂停/启动被切换。
`tick` 内部加"已在调度中"的短路，避免同一时刻跑两次。

#### 3.3.3 四个动作

| 动作 | 前端 | 后端 | 效果 |
|---|---|---|---|
| 发送（跑着时） | `POST .../queue` `{op:'add', text, images}` | 追加 `queued` 条目，落盘 | 进队尾 |
| 引导 | `POST .../queue/:itemId/steer` | 若该会话在跑：把条目文本（+图）经 `session.steer()` 送进当前轮；条目标记 `sent`（引导态）并**补写转录**（修 §1.2 的洞）；若恰好已空闲：退回 `queued`；若没在跑：直接当一次正常发送 | 表面上像直接发送（消息出现在对话流里），实际插队到下一次请求 |
| 删除 | `POST .../queue/:itemId/remove` | 移除条目、落盘 | 消息丢弃 |
| 关闭排队 | `POST .../queue/:itemId/close` | 移除条目，并把 `text/images` 回填输入框（响应带回填内容） | 不再自动发，内容回到输入框（草稿） |

**引导的独立性**（G13）：目标跑着时点引导，同样走 `steer` —— SDK 层面目标也是普通 run，
引导插进它下一次请求即可。

#### 3.3.4 编辑（保持原位置，G3）

- 前端点「编辑」：条目 `state:"editing"`（**位置不变**），文本+图片回填输入框
  （与现在的消息编辑同款：`editIntoComposer` 的效果）；
- 队列**阻塞**在该条（§3.3.2 的第 3 条）：当前轮跑完也不发它，一直等；
- 用户点发送 ⇒ `POST .../queue/:itemId/update { text, images }`，条目**原位**替换内容、
  状态回 `queued`，随后正常调度；
- 点取消（✕）⇒ `POST .../queue/:itemId/cancel-edit`，状态回 `queued`、内容不变；
- 编辑中删除 ⇒ 条目移除（输入框里的内容保留，用户自己决定发不发）。

### 3.4 目标模式（goal）

#### 3.4.1 安装

cloud-server 初始化时把 goal 插件的 hook 包装进
`<agent_state>/hooks/goal/`（SDK 已导出 `installHook` / `libraryPlugin('goal')`，
实测 `loadLibraryPlugins()` 能读到 goal 的 manifest：`stop:[stop.mjs]` +
`user_prompt:[start.mjs]`）。空 hooks 目录现在是现状（§1.4），装了才有目标功能。

**注意（已实测 0.2.13 的真实行为）**：`user_prompt` 命令**只由宿主显式调用
`Session.runUserPromptHook(name, …)` 时运行** —— 0.2.13 的 `dist/index.js` 里
`userPromptHooks` 全库仅三处引用（声明、构造赋值、`runUserPromptHook` 内部查找），
`run` 主循环里**不消费** `user_prompt`。也就是说：装了 goal 包也不会"每条消息都启动目标"，
启动与否完全由宿主决定（正是我们要的）。

官方文档（penguin.ooo/docs/skills）描述的更新版 SDK 引入了 `trigger: "prompt" | "host"`：
缺省 `prompt` = 每条用户消息都运行；`host` = 只在宿主显式调用时运行。判定规则里有一条
兼容线：**manifests 的 version 低于 `2026.09.29.1` 时，无 `trigger` 的 `user_prompt` 按
`host` 读**。当前 goal 的 version 是 `2026.09.01.1`（低于线），因此即使 SDK 升级也安全。

⇒ 实现时仍**在安装器写入的 hooks.json 里显式补 `trigger:"host"`** 作为双重保险 ——
将来 goal 插件升过 `2026.09.29.1` 时行为也不会翻转。**除这一处外，manifest 原样安装**
（`stop` 命令照装、照用，见 §3.4.4 —— 暂停不靠改 manifest 实现）。

#### 3.4.2 启动一次目标

1. 用户发一条带目标的消息（输入框顶部有目标标记，文本 = objective）；
2. 后端调 `session.runUserPromptHook('goal', objective, { budget })`；
3. hook 写 `GOAL.json`（`objective/status:active/budget/round:1/tokens_used:0`）；
4. 返回的 `context` 紧跟用户消息发出（`sender:"harness"`）——这是**第 1 轮**的输入；
5. `session.run` **原装自动连播**：每轮结束 SDK 自动问 `stop` hook，
   `continue` 就接下一轮（最多 100 轮由脚本兜底），直到 `stop`
   （完成 / 受阻 / 预算尽 / 轮次上限）。

**目标状态的读取**：宿主读 `GOAL.json` → `{objective, status, budget, round, tokens_used}`，
经 SSE 推给前端渲染（`goal_state` 事件）。status 词表：
`active | complete | blocked | budget_limited | aborted | wrapping_up`（后两者是进行中/收尾态）。

#### 3.4.3 预算编辑（G5）

- 弹框两种填法，用户选一个：
  - **总预算**：直接写 `budget`（留空/0 = `-1` 不限）；
  - **再跑多少**：`budget = tokens_used + N`（由后端换算，前端只传 `mode:'delta', value:N`）。
- 写 `GOAL.json` 的 `budget`，**下一轮生效**（§1.4 已证实：stop.mjs 每轮重读）。
- 目标内容（objective）也可改：直接改 `GOAL.json` 的 `objective`（下一轮重启注入时用新文本）。

#### 3.4.4 暂停 / 启动（G14）

**用户口径（2026-10-08，采纳）：不碰 `stop` hook、不改 manifest、不重写轮次逻辑 ——
用"把目标文件收走"实现暂停，用"放回 + 踢一脚"实现启动。** 官方自动连播原样使用。

**为什么这样成立（已实测插件的代码）**：`stop.mjs` 每轮结束先读 `GOAL.json`
（`readGoal`）；**文件不存在时返回 `null` ⇒ 脚本 `process.exit(0)`，什么都不输出** ⇒
SDK 收到"没有决定" ⇒ 循环自然结束（`run` 返回）。也就是说：

| 动作 | 宿主要做的事 |
|---|---|
| **暂停** | 把 `GOAL.json` **改名挪走**（如 `GOAL.json.paused`，内容原样保留）+ 记一个 `goalPaused` 标记（会话文件里）。当前轮照常跑完；跑到终点时文件不在 ⇒ 官方循环自己停住。**一轮都不会多跑。** |
| **启动** | 把文件**改回原名**（此时 `status`/`round`/`tokens_used` 原样恢复）+ 清掉暂停标记 + **踢一脚**：宿主执行一次官方的 `stop.mjs`（喂 `{hook:"stop", session_id, trace_path}`）拿它输出的 continue 文本，作为下一轮的输入发起 `run`（等价于 SDK 本来会做的事）。 |

**状态文件的语义**：`GOAL.json` 仍是**唯一真相**（objective/status/budget/round/tokens_used）；
暂停标记（`goalPaused`）是纯宿主侧的小旗子，不进 GOAL.json（插件不认这个词，写进去会被判成
坏通道 ⇒ 直接 blocked 收场 —— 见 `stop.mjs` 的协议外分支）。

**两个必须处理的边角**（防脏数据，G15）：
1. **暂停期间模型写回文件**：暂停生效要等当前轮跑完，而那一轮里模型可能自己写
   `GOAL.json`（比如它认为完成了）⇒ 文件"复活"。宿主在暂停态下**要守住缺席**：
   轮结束后若发现文件又出现了，再挪走一次（保留最新内容，但状态仍记为暂停）。
   下次启动时以这份最新内容为准。
2. **暂停时文件不存在**（从没启动过目标）：踢一脚无意义 ⇒ 启动动作降级为"清标记"即可。

**Trace 路径**：启动时执行 `stop.mjs` 需要当轮 Trace 的路径（脚本从 Trace 的
`session_meta.agent_state` 反推 scratchpad，见 `hooks/lib.mjs` 的 `scratchpadDirOf`）。
复用 `packages/cloud-server/src/agent/traceFork.ts:21-29` 的按 sessionId 定位逻辑
（与 SDK 目录口径一致：`traces/<日期>/<sessionId>_*.jsonl`）。

#### 3.4.5 目标标记（G5）

输入框顶部一条标记（与「正在编辑」那条同款，`AgentConversation.vue:972`）：
`🎯 目标内容… · 预算 50k`，右侧一个编辑钮（弹预算框）、一个 ✕（去掉目标，按普通消息发）。
输入框文本里的目标正文 = objective；发送时后端按"这一条带 goal"处理。

### 3.5 通知（G11）

**现状**：两个开关是死的（§1.5），没有任何 `new Notification` 调用。

**改法**：通知不是 hook 的活（浏览器通知只能由页面弹，后台脚本弹不了）——
由**后端发事件 + 页面弹通知/播音**：
1. 后端在以下时刻通过现有 SSE 通道推事件：一轮结束（`round_done`）、
   队列全部跑完且会话空闲（`queue_idle`）；
2. 页面（`AgentConversation.vue` 或新的 composable）监听这两个事件，按设置分两路：
   - **浏览器通知**（开）⇒ `new Notification(标题, { body })` —— 走系统通知中心
     （Windows 右下角/通知栏），即使切到别的标签页也能看到；
   - **通知声音**（开）⇒ 页面用 `Audio` 播一个短提示音 —— **独立开关**：
     系统通知自带的提示音由浏览器/操作系统管，网页控制不了，所以要响得由页面自己播。
3. **两个开关都在全局设置弹框里**（§3.6.3 第二组的现有两行，位置不动），
   存后台 KV、刷新后保持；「浏览器通知」还需浏览器权限
   （已有权限申请入口复用 `enableNotify`，`AgentConversation.vue:638`）。

**页面完全关闭时**不弹（用户已确认不需要推送，见「不做清单」）。

### 3.6 界面

#### 3.6.1 输入区布局（G9 的最终形态）

```
┌───────────────────────────────────────────┬──────┐
│ [图] 第一条排队消息        ↳引导  🗑  ⋯     │  ↑   │  ← 滚动到底部（不贴底时出现）
│ [图] 第二条排队消息        ↳引导  🗑  ⋯     │  ⏸   │  ← 暂停/启动（有队列时出现）
└───────────────────────────────────────────┴──────┘
┌───────────────────────────────────────────────────┐
│  [🎯 目标 … ✎ ✕]                                   │  ← 目标标记（有目标时）
│  [正在编辑 …]                                      │  ← 编辑标记（编辑队列/消息时）
│  输入框                                            │
│  [+] [模式] [授权] [模型] …            [环形] [发送] │
└───────────────────────────────────────────────────┘
```

数值（对齐 `ui-style-guide.md`）：
- 队列列表整体：贴输入框上缘（`margin-bottom:0`，与输入框之间无间隙），宽 **80%**、靠左，
  右侧留一列（宽 36px）给两个按钮；
- 每行：高 **28px**（小行，与 `.ac-editing-mark` 的 26px 同量级），左侧小缩略图
  **16×16**（与文字等高，`border-radius:4px`），中间文本 12px 省略号，右侧三个按钮；
- 行内按钮：图标 12px、命中区 24×24（行高限制，不能再大）、`aria-label` 齐全；
- 右侧按钮列：两个按钮 28×28、圆角 8、上下排列 gap 4；上「回到底部」（沿用
  `.ac-to-bottom` 的观感：细边 + 面板底 + 柔和阴影），下「暂停/启动」（暂停=⏸，启动=▶）；
- 行 hover 底色用 `--ui-hover`，编辑中行用 `--ui-warn-soft` 级别的弱琥珀底 + 灰字；
- **原 `.ac-to-bottom` 骑在输入框上边框的位置取消**（用户口径：队列占了那个位置）。

#### 3.6.2 `⋯` 菜单（只有两项）

`编辑消息` / `关闭排队`。用设计系统目录里的 `dropdown`（`useUiComponent('dropdown')`，
现在的四个下拉都是它，`AgentConversation.vue:64` 起）。

#### 3.6.3 设置弹窗（G12）

`ModalsArea.vue` 的「TV DIRECTOR 全局设置」（**就是含「协作模式」的那个全局弹框**）
第一组卡片新增两行：

| 行 | 说明 | 控件 |
|---|---|---|
| 协作模式（现有） | —— | 开关 |
| **后台对话**（新） | 开启后，对话在后台继续跑：离开或关闭浏览器也在跑，刷新后重新进入该对话能继续之前的对话流 | 开关，默认开 |
| **目标设置**（新） | 目标模式的默认值：「点 + → 目标时直接用这里的默认预算」 | 一行默认预算数字输入（默认 50000，0=不限） |

第二组的「浏览器通知 / 通知声音」接真（§3.5）。通知类型说明：浏览器系统通知
（`new Notification`，走操作系统通知中心）；通知声音是**页面自己播的短提示音**
（系统通知的提示音由浏览器/操作系统决定，网页控制不了，所以声音做一个独立开关）。

#### 3.6.4 `+` 菜单（G12）

点 `+` 弹**两项**：**目标** / **上传文件**。
- 上传文件 = 现有 `pickImages()`；
- **目标** = 直接在输入框上方加一个**目标标签**（objective 空、提示"输入目标内容"；
  预算直接用全局设置里的默认值）—— **不弹框**；
- **只有点那个目标标签本身**，才弹出目标编辑框（写 objective、改预算，§3.4.3）。

### 3.7 特殊情况（G15，逐条给行为）

| 场景 | 行为 |
|---|---|
| 引导撞上"轮刚好跑完" | 后台统一裁决：steer 返回 false ⇒ 条目退回 `queued`，由调度器按序发出（**不丢、不重复**） |
| 引导时根本没在跑 | 直接当普通发送（不进队列），与"立即发送"一致 |
| 暂停/编辑期间用户又发消息 | 进**队尾**（`queued`），不插队不直接发 |
| 终止（红方块） | 停当前轮 + **自动暂停队列**（避免下一条立刻顶上）；队列消息保留 |
| 删除正在编辑的条目 | 条目移除；输入框内容保留（用户自己决定） |
| 队列里的目标是"未启动"的 | 轮到它时按目标模式启动（先 `runUserPromptHook` 再跑） |
| 目标进行中点引导 | 插进目标当前轮的下一次请求（§3.3.3，G13） |
| 目标运行中收到普通排队消息 | 等目标**停下**（完成/受阻/预算尽/暂停）后再按队列顺序发 |
| 刷新页面 | 正在跑：接回流（转录 + 快照 + 实时）；队列/暂停/编辑中状态原样恢复 |
| 后台服务重启 | 正在跑的一轮断（无法避免，SDK 内存态）；队列不丢，重启后按对账规则继续 |
| 一条消息只发一次 | §3.3.1 的原子流转 + 对账规则；`sending` 条目不重复取 |
| 两个标签页同时开着 | 队列推进由后台裁决；两边看到的是同一条流（各自订各自的） |

---

## 四、接口清单（后端新增/改动）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `.../sessions/:id` （改） | 返回体加 `queue`、`goal`（读 GOAL.json）、`paused` |
| GET | `.../sessions/:id/stream?since=N` （新） | 接回正在跑的流（含已发事件回放） |
| POST | `.../sessions/:id/queue` （新） | `{op:'add'|'update'|'remove'|'close'|'cancel-edit'|'pause'|'resume'}` |
| POST | `.../sessions/:id/queue/:itemId/steer` （新） | 引导（插队） |
| POST | `.../sessions/:id/goal` （新） | `{op:'update', budget?, deltaBudget?, objective?}`；`{op:'pause'|'resume'}` |
| GET/PUT | `/api/kv/config/agentRunMode`、`agentNotify`、`agentGoalDefaults` （复用 KV） | 三个设置项 |

SSE 事件新增：`queue`（队列变化快照）、`goal_state`（目标状态）、`round_done`、`queue_idle`。

---

## 五、测试与验收

### 5.1 单测（各包自跑）

- `cloud-server`：队列状态机（加/删/改/引导/关闭/暂停、原子流转、对账）、
  RunHub（订阅/回放/断开不 abort）、目标读写（GOAL.json 解析、预算两种模式换算、
  暂停不回 status）、通知事件（round_done / queue_idle）；
- `plugin-agent`：队列视图模型（顺序、编辑阻塞、未读数）、目标标记、按钮状态矩阵；
- `ui`：设置弹窗三个开关的读写（KV 路径）。

### 5.2 真机验收（Chrome MCP，走 `docs/STATUS.md` 的流程）

逐条对 G1–G15 打勾，重点：
1. 跑着发消息 → 按钮仍是发送、消息进队列、列表显示（含图片缩略图）；
2. 编辑第 1 条 → 位置不变、队列阻塞；发送后从原位继续；
3. 引导 → 消息出现在对话流里、模型下一次请求才看到；
4. 刷新 → 正在跑的那轮不断、回来接着看流；队列/暂停/编辑状态还在；
5. 目标：`+` → 选择目标（不弹框）→ 发送 → 轮次推进；编辑预算 → 下一轮生效；
6. 目标暂停/启动；
7. 通知：每轮一条 + 队列跑完一条（开关在设置里）。

---

## 六、不做清单（本期明确不做）

1. 页面完全关闭时收系统通知（需要 Service Worker + 推送，用户已确认不需要）；
2. 队列跨标签页"多端一致"以外的多设备同步（本机单实例范围）；
3. 目标轮次上限做成可配置（沿用插件的 100 轮兜底）；
4. 队列消息的拖拽排序（本期只有删除/编辑/引导/关闭）。

---

## 七、已定 / 待定

**已定（2026-10-08 用户答复）**：

1. **目标的暂停/启动 = 收走/放回 `GOAL.json`**（§3.4.4）—— 不改 manifest、不用花哨机制；
   官方 stop hook 自动连播原样使用。
2. **目标与队列的优先级**：目标运行中收到普通排队消息 ⇒ 等目标**停下**再按队列顺序发
   （§3.7）。
3. **通知文案与行为**：标题=会话名，正文=最后一句摘要；点通知 = 聚焦窗口 + 打开该会话；
   声音独立开关（§3.5）。
4. **`+` 菜单只有两项**（目标 / 上传文件）；点标签才弹编辑框（§3.6.4）。

**待定（评审时拍板）**：

1. 目标安装时给 `user_prompt` 补 `trigger:"host"` 的双重保险（§3.4.1）—— 当前 SDK
   行为下无影响，只是防将来升级翻转；**其余 manifest 原样**。
2. 队列的事件缓冲上限具体数值（§3.2 第 5 点，暂定 2000 条 / 500KB）。

---

## 八、影响面与风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 托管运行改变现有 e2e 断言 | `agent-e2e.mjs` 有对 `state.running`、`.ac-send.is-running` 的直接断言 | 改动时同步更新 e2e；先跑既有用例看红 |
| 队列写入会话文件 | 与 `sessionStore` 的并发写（转录追加 vs 队列更新） | 复用现有原子写 + 串行队列；测试覆盖并发 tick |
| goal 安装改 hooks.json | 见待定 1 | 评审拍板 |
| 悬停/紧凑行的可达性 | 28px 行 + 24px 按钮低于规范 32px | 行 hover 时才显示按钮（`.ac-msg-actions` 同款先例），并在文档记明偏差 |

---

## 九、实现偏差与实测记录（2026-10-08 落地后回写）

设计与最终实现有四处值得记下来的偏离/补充（**以实测为准**）：

1. **编辑需要独立的 op**（设计 §3.3.4 只说"标记 editing"，没定 API）。实测发现用
   update 代替会把状态刷回 queued、编辑阻塞失效 —— 于是新增 op:'edit'（只改状态、不碰内容；
   改完仍由 update 原位替换并回 queued）。同时补了路由层的 op 白名单测试：
   **不需要正文的 op 少列一个就会被挡成 400**（真踩过一次）。
2. **queue_idle 只在"从有到无"那一次发**（设计 §3.5 只说"队列跑完"）。否则每次 tick
   （一轮结束、用户点一下）都会广播一遍，界面会收到一串重复通知。
3. **resume 失败要能优雅回退**（设计没提）。实测：会话有转录记录、但 SDK 侧没有对应 Trace
   （例如队列在第一条消息真发出去之前就落了会话记录）时 resumeSession 会抛
   "Session does not exist"。现在捕获它并**回退新建会话**，让这一轮照跑。
4. **发失败后要冷却**（设计没提）。起不来通常是配置问题（没配模型），而 tick 会被反复触发 ——
   没有闸就会以极快频率重试同一条、刷爆日志。现在失败后 30 秒内不自动重试
   （用户的下一次操作照常立即生效）。

**验收证据（2026-10-08）**：
- 单测：cloud-server **484** 全绿 + tsc 干净；plugin-agent **197** 全绿 + tsc 干净；
  ui **189** 全绿 + vue-tsc 干净。
  （本次新增：sessionStoreQueue 7、sessionHub 10、queueScheduler 11、agentQueueRoute 12、
  goalInstall 9、goalRuntime 13、agentQueueApi 7、queueModel 17、agentNotify 22、queueUi 13、
  agentSettings 17。）
- 端到端探针 packages/cloud-server/e2e/queue-goal-probe.mjs（真服务 + 真磁盘）：
  goal hook 包装上（hooks.json 带 trigger:"host"、stop 保留）、队列增删改读、
  队列写进会话文件、暂停/恢复、目标端点语义（没有目标时 404 而非 500）、SSE 重连端点、
  未知 op 400 —— **ALL PASS**（"建会话"一条因本机没配模型凭据而 SKIP）。
- 真机（Chrome MCP，真 Chromium）：+ 菜单**只有两项**（目标 / 上传文件）、点「目标」出现标签
  且**不弹框**（"输入目标内容 · 预算 50k"，预算取设置默认值）、点标签才弹编辑框（含两种预算填法）、
  发送键初始态为禁用、旧「回到底部」已不在输入框内部。

---

## 十、名词对照（避免评审时歧义）

| 词 | 在这份文档里的确切含义 |
|---|---|
| 一轮 / 轮 | 用户发一条消息 → 模型跑到「这一条回答完」为止（含期间的工具调用）；SDK 里叫一个 Task |
| 队列 / 排队 | 宿主自己维护的「待发消息列表」；**不是** SDK 的 steeringQueue |
| 引导 / 插队 | 把一条消息经 `session.steer()` 插进**正在跑**的那一轮的下一次请求；表面上像直接发送 |
| 终止 | 用户点红方块：abort 当前轮（+ 按 §3.7 自动暂停队列） |
| 暂停 / 启动 | 只针对**队列的自动发送**（暂停 = 不再自动发下一条）；目标的暂停/启动是另一件事（§3.4.4） |
| 后台对话 | 设置里的开关（用户口径的正式名字）：开 = 一轮的生命周期不跟浏览器连接绑定，离开/关闭浏览器也继续跑，刷新后能继续看到流 |
| 目标标签 | 输入框上方那一条目标标记；**点它**才弹目标编辑框 |
| 目标编辑框 | 写 objective、改预算（总预算 / 再跑多少）的弹框 |
| 目标 / goal | 用 `@penguinharness/goal` 插件驱动的「循环推进一个 objective 直到完成/受阻/超预算」 |
| GOAL.json | 目标的状态文件（objective/status/budget/round/tokens_used），落在会话 scratchpad；**暂停时被改名挪走**（§3.4.4） |
| 会话文件 | `<root>/canvases/<canvasId>/agent/sessions/<sessionId>.json`（宿主自己的转录 + 本次新增的 queue） |
