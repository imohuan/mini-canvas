# 能力详解 · agent：对话轮次中间件

**一句话定位**：`ctx.agent.use(mw)` 让插件在**每次 AI 对话轮次进模型之前**拦一道 —— 可以改写用户输入（补上下文、脱敏、改提示词），也可以直接拦截不进模型（敏感词、配额用完自己回一句）。

## 这篇能让你做什么

- 写一个改写输入的中间件（比如自动补画布上下文）；
- 写一个拦截中间件（敏感词 / 配额）；
- 明白 pre-turn 环绕语义和 order 排序规则。

## 完整代码

```js
// 文件：<数据根>/server-plugins/demo-agent.js
// 格式：自包含单文件后台插件
// 作用：演示 ctx.agent.use 的改写与拦截两种形态

export const name = 'demo-agent'

export function apply(ctx) {
  ctx.agent.use(async (turn, next) => {          // ① 每次轮次进模型前经过这里
    // ② 拦截：不调 next() 就不进模型，自己给响应
    if (turn.input.text.includes('内部资料')) {
      return { blocked: true, response: { ok: false, error: '包含敏感词，已拦截' } };
    }

    // ③ 改写：改 turn.input 就是「进入前加工」
    turn.input.text = '【已审查】' + turn.input.text;

    // ④ 放行：交给下一个中间件（没有就直接进模型）
    return next();
  }, { order: 10 });

  // ⑤ 追加系统提示（拼在每轮输入前面）
  ctx.agent.systemPrompt('请用简洁中文回答。');
}
```

验证：装上后在画布 Agent 里发一条含「内部资料」的消息 —— 不会调模型，直接收到拦截响应；发普通消息 —— 正常对话，后台日志能看到改写生效。

## 每一步在干什么

- **① pre-turn 位置**：中间件插在 Agent `runtime.run()` **之前** —— HTTP 路由拿到 `{canvasId, text, images, prefs}` 后先跑中间件链，再把加工后的 `input` 交给 runtime。为什么不在生成器内部插：`yield` 不能在嵌套函数里用、中间件需要 `await next()` 的环绕语义（文件头注释原文两条硬障碍）。
- **② 拦截**：返回 `{ blocked: true, response: ... }` 且**不调 next()** —— 后面的中间件和模型都不跑。响应任意可 JSON 化。
- **③④ 改写与放行**：直接改 `turn.input` 的字段（text / images / sessionId / prefs）；`turn.abortSignal` 也能读（做短路判断）。`next()` 是洋葱式 —— 放行后还能在返回前做后处理。
- **⑤ order 排序**：数字小者在外层（先执行、后收尾），与前端注册场规则一致。缺省 0。
- **空链零开销**：没有插件注册中间件时，链直接返回 `{}`，行为与不加中间件一字不差。
- **回收**：中间件登记在注册场（`server/agent-mw`），条目归注册方插件 —— 卸载插件即摘掉它的中间件（有测试锁）。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 中间件形状 | `packages/cloud-server/src/serverFramework/agent.ts` 的 `AgentMiddleware` | `(turn, next) => Promise<AgentTurnResult>` |
| turn 字段 | 同上 `AgentTurn` | canvasId / input（text, images, sessionId, prefs）/ abortSignal |
| pre-turn 两条硬障碍 | 同上文件头 | yield 不能嵌套用；需要 await next() 环绕语义 |
| blocked 短路 | 同上 `runAgentMiddleware` 的 dispatch | 不调 next() → 后面全不跑 |
| order 排序 | 同上 `entries.sort((a, b) => a.order - b.order)` | 小者在外层 |
| 空链零开销 | 同上 `if (entries.length === 0) return {}` | 直接返回不改任何东西 |
| systemPrompt 追加 | 同上 `systemPrompt(text)` | 复用同一场，前拼 text 的标记条目 |
| 挂进 HTTP 层 | `packages/cloud-server/src/plugins/builtin/routes.ts`（agent-sessions 插件） | `(turn) => runAgentMiddleware(ctx, turn)` 传给 agentSessionRoutes |

## 常见坑

1. **next() 调了两次**：抛「next() 被调用了多次」。一个中间件里只调一次。
2. **以为能流式改模型输出**：不能 —— 中间件在模型调用**之前**，输出侧没有钩子。要后处理输出得在业务层做。
3. **在中间件里做慢操作**：每轮对话都会等它，拖慢所有对话。慢活儿（远程校验）自己加缓存或超时。
4. **blocked 时也调了 next()**：blocked 语义是「不调 next()」。调了又返回 blocked，行为未定义（后面的中间件还是会跑）。
5. **删不掉中间件**：注册场条目随插件卸载回收；运行期没有「单独摘中间件」的 API。showcase 的 DELETE 是置 inactive 标记（插件自己 state），不是摘条目。
