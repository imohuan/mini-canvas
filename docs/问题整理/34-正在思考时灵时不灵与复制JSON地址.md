# 34 · 正在思考时灵时不灵与复制JSON地址

- 状态：已完成
- 负责人：Codex
- 完成时间：2026-11-17

## 你的原话

> 首先，你的“正在思考”我有些时候看得到，有些时候看不到，这是什么情况？感觉时灵时不灵的。
> 其次，我希望你可以在顶部右侧红色框的位置添加一个复制按钮，点击之后复制当前对话的一个 JSON 文件地址。

## 要解决的问题

1. 「正在思考」在一轮运行期间要稳定可见，不能时有时无。
2. 面板头部右侧要有一个复制按钮，点一下把**当前对话的 JSON 文件地址**复制到剪贴板。

## 范围与位置

- 页面：画布右侧 Agent 面板（消息流底部加载行 / 面板头部按钮）
- 参考代码：`packages/plugins/plugin-agent/src/ui/conversation/AgentMessageList.vue`（加载行）、`packages/plugins/plugin-agent/src/ui/conversation/useAgentMessageViews.ts`（`thinkingLive`）、`apps/web/src/components/areas/AgentPanel.vue`（头部按钮）、`packages/plugins/plugin-agent/src/server/routes/agentSessions.ts`（`json-path` 路由）、`packages/plugins/plugin-agent/src/api/agentApi.ts`（`sessionJsonPath`）
- 相关资源：本问题没有图片（用户截图见对话记录）
- 关联问题：无

## 现在 vs 期望

| | 现在 | 期望 |
| --- | --- | --- |
| 正在思考 | 一出正文就消失、没出正文时也不出现，某一轮完全看不到 | 只要这一轮在跑就显示；有思考行时才不重复显示 |
| 复制入口 | 头部没有 | 头部最左侧一个复制按钮，点完短暂打勾 |
| 复制内容 | 无 | 当前会话 JSON 在这台机器上的绝对路径 |

## 问题原因

- 状态：已确认
- 复现步骤：发起一轮对话，观察消息流底部的加载行；再点面板头部看有没有复制入口。
- 证据：加载行条件原本是 `showPendingOn(t) && !thinkingLive(t)`，而 `thinkingLive` = 「在跑 + 还没出正文」。模型不吐思考块时条件恒为假（加载行被隐藏），一旦出了正文条件变真（加载行才出现），所以肉眼上时灵时不灵；另外面板头部原本只有新建 / 历史 / 偏好 / 停靠 / 关闭五个按钮。
- 根因：去重条件用错了信号 —— 本意是「已经有一条在跑的思考行时别重复画」，却用了「有没有正文」来判断。

## 修改方案

- 改哪里：`useAgentMessageViews.ts` 新增 `liveThinkingRow`，`AgentMessageList.vue` 改用它做去重；`AgentPanel.vue` 头部加复制按钮；后台新增 `GET /sessions/:id/json-path`，服务层暴露 `sessionJsonPath()`。
- 怎么改：`liveThinkingRow` = 在跑 + 最后一行是思考块；按钮调用服务取路径后写剪贴板，成功打勾 1.4 秒并提示，失败用 toast 说明原因（地址由后台按自己的数据根算，前端不猜 `~/.plume`）。
- 为什么这样改：加载行只负责「这一轮在跑」这件事，与正文无关；路径规则只该在后台维护一份，`-d` 改数据根时也能对上。
- 风险 / 影响面：只影响加载行的显示条件与头部多一个按钮；复制读的是会话 JSON 的真实落点，不读取内容、不外发。
- 验证方式：新增两个源码契约测试 + 一个后台路由测试，并在真实浏览器里点击按钮读取剪贴板。

## 验收标准

- [x] 一轮运行期间加载行稳定显示，不再随「有没有正文 / 有没有思考块」闪烁
- [x] 已经有一条在跑的思考行时，不重复显示加载行
- [x] 面板头部出现复制按钮，点击后剪贴板内容是当前会话 JSON 的绝对路径
- [x] 复制的路径指向磁盘上真实存在的会话文件；会话不存在时接口返回 404
- [x] 会话还没打开时按钮给出明确提示，而不是静默无反应

## 不能动

- 不改消息流里思考行的展开 / 收起逻辑
- 不改头部其余按钮的顺序与行为
- 不把会话 JSON 内容发给外部服务（只复制本机路径）

## 假设与待确认

- 假设：用户要的是「文件地址」而不是「文件内容」，因此复制的是绝对路径。
- 待确认：无。

## 执行指令

修正加载行的去重条件，在面板头部加「复制对话 JSON 地址」按钮，并由后台提供该会话 JSON 的真实路径。

## 图片

本问题没有图片。

## 执行记录

- 改动文件：`packages/plugins/plugin-agent/src/ui/conversation/useAgentMessageViews.ts`、`packages/plugins/plugin-agent/src/ui/conversation/useAgentConversation.ts`、`packages/plugins/plugin-agent/src/ui/conversation/AgentMessageList.vue`、`packages/plugins/plugin-agent/src/server/routes/agentSessions.ts`、`packages/plugins/plugin-agent/src/api/agentApi.ts`、`packages/plugins/plugin-agent/src/service/queue/queue.ts`、`packages/plugins/plugin-agent/src/service/agentService.ts`、`packages/plugins/plugin-agent/src/service/types.ts`、`apps/web/src/components/areas/AgentPanel.vue`、测试 `pendingIndicatorAlways.test.ts` / `sessionJsonPath.test.ts`
- 验证命令与结果：`pnpm -C packages/plugins/plugin-agent typecheck` 与 `pnpm -C apps/web typecheck` 通过；`pnpm -C packages/plugins/plugin-agent test` 只有既有的 `panelDetailFixes`「右侧留白只在内容层写一次」失败（与本次改动无关）；`pnpm -C apps/server exec vitest run src/__tests__/sessionJsonPath.test.ts` 3 条通过。Chrome 实测（localhost:5289）：点击头部复制按钮后剪贴板为 `D:\\Code\\Git\\mini-canvas\\.plume\\canvases\\59343957e74b4ce9\\agent\\sessions\\session-2026-11-17-15-06-08-b65841e7.json`，该文件存在。
- 完成时间：2026-11-17
