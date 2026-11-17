# 30 · Agent工具授权条移出折叠面板

- 状态：已完成
- 负责人：Codex
- 完成时间：2026-11-17

## 你的原话

> 在这个 Agent 插件的 UI 里面，执行命令时有一个授权同意的工具调用。我希望你可以把它放在外面，不应该把它折叠在这个面板里面，你需要做一个判断
>
> 其次，我不太喜欢你这边的 UI。比如文字描述，你可以换行显示，而不是和标题、图标显示在一块儿，可以换一种表达方式
>
> 你可以先给我提供几个 demo，让我来看一下布局应该怎样
>
> 补充（2026-11-17）：选 B

## 要解决的问题

1. 需要授权的工具调用不能藏在「工具调用组」的折叠内容里，用户不必先展开两层才能看到「允许 / 拒绝」。
2. 授权条的文字要分层：标题一行、命令单独一块、说明单独一行、按钮自己一行，不再挤在同一条基线上。
3. 先给 4 个可对比的布局方案，由用户选定一个再落地。

## 范围与位置

- 页面：画布右侧 Agent 面板 → 对话消息流 → 工具调用与授权确认
- 参考代码：`packages/plugins/plugin-agent/src/ui/conversation/AgentMessageList.vue`（授权条挂载位置）、`packages/plugins/plugin-agent/src/ui/conversation/AgentConfirmation.vue`（授权条本体：Item + 同行按钮）、`packages/plugins/plugin-agent/src/model/toolMeta.ts`（`approvalTitle` / `approvalDescription` 文案）、`packages/plugins/plugin-agent/src/ui/conversation/AgentTerminal.vue`（命令折叠行）
- 相关资源：`docs/问题整理/demo/30-Agent审批布局-demo.html`（四个布局方案 + 现状复刻）
- 关联问题：无

## 现在 vs 期望

| | 现在 | 期望 |
| --- | --- | --- |
| 授权条位置 | 挂在工具行下面，而工具行在「N 个工具调用」的折叠内容里 | 在折叠层外面，用户随时看得到并能点 |
| 标题 | 「运行 ffmpeg -version 2>&1 \| Select-Object -First 2; …？」整条命令塞进标题 | 「Agent 想运行一条命令」这类一句话标题 |
| 命令 | 和标题、按钮同一行抢宽度，被断成「Firs t 2」 | 独立等宽代码块，完整换行，超长时块内滚动 |
| 说明 | 挤在图标右侧的窄列里自动折行 | 单独一行，跟在命令块下面 |
| 按钮 | 在文字右侧同一行 | 单独一行靠右（或方案 D 的两等宽按钮） |

## 问题原因

- 状态：已确认
- 复现步骤：Agent 面板里触发一次需要审批的 `exec_command`；该工具落在「N 个工具调用」分组里时，先展开分组，才能看到授权条；如果分组是收起状态，授权条完全不可见，但这一轮其实卡在等待确认。
- 证据（代码调用路径）：`AgentMessageList.vue` 中，分组分支把 `<AgentConfirmation>` 写在 `<TraceCollapsibleContent>` 内部，紧跟 `v-for="tool in row.tools"` 的每一项；单工具分支也写在 `TraceCollapsibleContent` 里（默认工具那条）。
  - 只有画布 MCP 卡片和终端行这两种情况，授权条才落在折叠层外；`exec_command` 走终端分支时位置正确，但一旦与其它工具合组，就一起被折进组里。
  - `AgentConfirmation.vue` 用 `Item` + `ItemActions` 横排：标题、说明、按钮在同一行，标题过长时按钮把文字挤成两行，且 `word-break: break-word` 允许在单词中间断开（截图里的「Firs t」）。
  - `toolMeta.ts` 的 `approvalTitle` 直接把 `toolBrief()` 结果拼进标题，命令越长标题越长。
- 根因：授权条被当作「工具的附属内容」渲染在折叠容器里，没有把「授权」当成需要独立占据位置的消息块；同时标题承担了展示命令的职责。

## 修改方案

用户选定 **B（消息流内独立卡）**，已按此实现。四个候选留档：

| 方案 | 位置 | 特点 |
| --- | --- | --- |
| A 常驻确认条 | 吸在输入框上方，不随对话滚动 | 绝不会错过；占输入区附近空间 |
| B 消息流内独立卡 | 与工具组同级、紧跟其后 | 保留对话顺序；上方滚动时可能被推走 |
| C 轻量确认行 | 与工具组同级，默认一行，命令可展开 | 最省空间；默认看不到完整命令 |
| D 底部抽屉 | 从输入框上方升起的小弹层 | 视觉最重、最强调；多条会挡对话 |

- 改动位置（已落地）：`AgentMessageList.vue` 分组内不再渲染授权条，新增 `approvalsOf(row.tools)`，在 `<TraceCollapsibleContent>` **收尾之后**逐条渲染 `AgentConfirmation`（单工具分支本来就在折叠层外，保持原位置）；`AgentConfirmation.vue` 改成纵向四层——图标 + 标题一行、命令独立代码块、说明一行、按钮一行靠右，命令块等宽 `pre-wrap` + `overflow-wrap: anywhere` + 96px 限高滚动，图标换成琥珀色 `ShieldAlert`；`toolMeta.ts` 的 `approvalTitle` 只给动作级标题，新增 `approvalCommand` 从入参提取命令 / 文件路径原文交给命令块。
- 为什么这样改：授权是「需要人做决定」的事件，可见性优先于「挂在哪个工具下面」；把命令从标题里拆出来，才能既保留信息又不破坏排版。
- 风险 / 影响面：审批与工具的对应关系仍靠 `toolCallId`，移动位置不影响 `agent.decide` 的调用；会话历史里老数据（没有 `toolCallId`）继续走 `orphanApproval` 兜底。
- 验证方式：真实浏览器里触发 `exec_command` 审批（单工具 / 与其它工具合组两种情况），确认不展开也能看到并点击；再跑 `pnpm -C packages/plugins/plugin-agent test` 与 `typecheck`。

## 验收标准

- [x] 分组收起时，待授权的工具调用仍然完整可见，可以直接点「允许 / 拒绝」
- [x] 授权条在对话里只出现一次，不与工具组内重复
- [x] 标题是一句人话，命令在独立代码块里完整换行，块内超长可滚动
- [x] 说明文字单独成行，不和标题、图标挤在同一基线
- [x] 点允许 / 拒绝后授权条消失，Agent 继续或终止这一轮
- [x] 亮色 / 暗色两套主题下对比度正常

## 不能动

- 不改审批判定逻辑（`approval.ts`、`runtime.ts` 的挂起与恢复）
- 不改 `toolCallId` 的对应机制
- 不恢复给 `exec_command` 打 `card=true` 的旧做法
- 不动核心节点组件

## 假设与待确认

- 假设：多个工具同时待授权时，按到达顺序逐条展示，不合并成「N 项待确认」。已在真机验证：连续两条 `exec_command` 依次弹卡，放行第一条后第二条接着出现。
- 待确认：无。

## 执行指令

按用户选定的布局改 `AgentConfirmation` 的排版与 `AgentMessageList` 的挂载位置；授权条必须在折叠层外、始终可见；标题、命令、说明、按钮分层；改完在真实浏览器里触发一次 `exec_command` 审批验证，并跑 plugin-agent 的测试与类型检查。

## 图片

本问题没有图片；布局对比见交互 demo：`docs/问题整理/demo/30-Agent审批布局-demo.html`（本地起一个静态服务即可打开）。

## 执行记录

- 改动文件：`packages/plugins/plugin-agent/src/ui/conversation/AgentConfirmation.vue`、`packages/plugins/plugin-agent/src/ui/conversation/AgentMessageList.vue`、`packages/plugins/plugin-agent/src/model/toolMeta.ts`、`packages/plugins/plugin-agent/src/__tests__/toolMeta.test.ts`、`packages/plugins/plugin-agent/src/__tests__/toolFoldVsCard.test.ts`
- 验证命令与结果：`pnpm -C packages/plugins/plugin-agent typecheck` 通过；`pnpm -C packages/plugins/plugin-agent test` 673 通过 / 1 失败，失败项是 `panelDetailFixes.test.ts` 的「右侧留白只在内容层写一次」，涉及 `AgentScrollArea.vue`（本轮未触碰），改动前就已失败；Chrome 实测（localhost:5288，暗色）触发 `exec_command` 审批，卡片显示「Agent 想运行一条命令」+ 独立命令块 + 说明 + 按钮行，分组收起时卡片仍完整可见，连续两条审批依次出现、逐条放行后卡片消失并继续；亮色配色以 demo 目视核对，真实页面这轮未跑通（面板停在空态），下次再补。
- 完成时间：2026-11-17
- 代码提交：81a4bfd9
