# ctx.agent · 后端对话中间件

**一句话定位**：`ctx.agent` 让插件在**每次 AI 对话轮次进模型之前**拦一道 —— 可改写用户输入（补上下文、
脱敏），也可直接拦截（不调模型、自己回一句）。注册随插件卸载回收。

**属于哪一档**：后台框架能力段（`packages/cloud-server/src/serverFramework/agent.ts`）。

## 用法

```js
// 文件：<数据根>/server-plugins/demo-agent.js
export const name = 'demo-agent'

export function apply(ctx) {
  // ① 进入前加工：给每轮对话补一段上下文
  ctx.agent.use(async (turn, next) => {
    turn.input.text = '[前缀] ' + turn.input.text
    return next()
  }, { order: 10 })

  // ② 直接拦截：命中就回一句，不进模型（不调 next 即拦截）
  ctx.agent.use(async (turn) => {
    if (turn.input.text.includes('敏感词')) {
      return { blocked: true, response: { ok: true, text: '这条不能处理' } }
    }
    return { blocked: false }
  })

  // ③ 追加一段系统提示（最简）
  ctx.agent.systemPrompt('请用中文回答。')

  // ④ 给 Agent 加一个工具（落点与 ctx.mcp.tool 相同）
  ctx.agent.tool({ name: 'demo.now', description: '返回当前时间', handler: () => Date.now() })
}
```

## 方法

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `use` | `use(mw: AgentMiddleware, opts?: { order?: number }): void` | 加一个中间件（order 小者在外层，先执行、后收尾） |
| `systemPrompt` | `systemPrompt(text: string): void` | 追加一段系统提示（拼在用户输入前） |
| `tool` | `tool(def: McpToolDef): void` | 给 Agent 加一个可调用工具（同 `ctx.mcp.tool` 落点） |

## 形状

```ts
type AgentMiddleware = (
  turn: AgentTurn,
  next: () => Promise<AgentTurnResult>,
) => Promise<AgentTurnResult>

interface AgentTurn {
  canvasId: string
  input: { canvasId: string; sessionId?: string; text: string; images?: string[]; prefs?: unknown }  // 可变
  abortSignal?: AbortSignal
}

interface AgentTurnResult {
  blocked?: true        // true = 本轮被拦截，不进模型
  response?: unknown    // 拦截时给前端的响应
}
```

## 注意事项

1. **中间件跑在 `runtime.run()` 之前（pre-turn），不在生成器内部**：生成器里 `yield` 不能在嵌套函数用，中间件又需要 `await next()` 的环绕语义。所以正确位置是"HTTP 路由拿到 input → 先跑中间件链 → 再交给 runtime"。
2. **空链零开销**：没有中间件时直接返回 `{}`，行为与不加一字不差。
3. **不调 `next()` 即拦截**（koa 风格）；`{blocked:true}` 且不调 `next()` → 后面的都不跑。
4. **`next()` 只能调一次**：重复调抛 `[agent] next() 被调用了多次`。
5. **落点是注册场 `server/agent-mw`**（`systemPrompt` 与 `use` 共用，系统提示是"要在轮次前生效的加工"），条目归注册方插件，卸载即摘。

