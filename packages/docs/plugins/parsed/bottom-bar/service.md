# 服务 `nodeBar` 与 `nodeTask`

> 插件：底部状态栏 bottom-bar · [返回总览](/plugins/parsed/bottom-bar/)

**一句话**：本插件上架两个服务 —— `nodeBar` 管"有哪些动作、谁写得回结果"，`nodeTask` 管"跑一次任务、取消、刷新后续查"。

## 怎么拿

FJ => FJts
// 组件里一律用 ctx.get（根 ctx 没有服务代理，别直访 ctx.nodeBar）
  const bar = ctx.get('nodeBar')
  bar.list({ type: 'image' })          // 这个节点类型有哪些动作
  ctx.get('canvas').runBarAction(nodeId, actionId, input) // 跑动作（公开入口）
FJ => FJ

> 插件 `apply` 内可直访 `ctx.nodeBar`（服务解析 Proxy 只存在于插件作用域）。

## 服务一：`nodeBar`（`NodeBarService`）

**只读面**（读不落场，无所谓归谁）：

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `list` | `list(filter?: { type?: string }): BarAction[]` | 列出适用于某节点类型的动作（按 `order` 跨键升序） |
| `get` | `get(id: string): BarAction | undefined` | 按 id 查一条动作（不走 `list().find`） |
| `applierOf` | `applierOf(kind: string): BarApplier | undefined` | 查某类型的写入器 |
| `state` | `state(nodeId: string): NodeRunState` | 读节点当前运行态（不改写） |

**写入面**（给**别的插件**用；条目归**传入的 scope**）：

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `register` | `register(scope: PluginScope, action: BarAction): void` | 注册一条动作（等同 `registerBarAction`） |
| `registerApplier` | `registerApplier(scope: PluginScope, kind: string, fn: BarApplier): void` | 注册结果写入器 |
| `publishTools` | `publishTools(scope: PluginScope, opts: PublishToolActionsOptions): () => void` | 把 `ctx.tools` 里某类工具自动发布成底栏动作 |

> **为什么写入面要收 scope**：本服务是共享单实例，`this.ctx` 恒为 bottom-bar 的 scope。若直接用 `this.ctx` 落场，别人的动作会挂在 bottom-bar 名下 —— 那家插件卸载时摘不掉自己的动作（留一条指向已死插件的 `run`）。传调用方自己的 ctx 落场，卸载才会自动回收。

## 服务二：`nodeTask`（`NodeTaskService`）

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `run` | `run(nodeId, actionId, input?): Promise<ToolResult>` | 起一次任务；返回动作的最终结果（UI 不必再读节点） |
| `cancel` | `cancel(nodeId: string): void` | 取消某节点正在跑的任务（覆盖层「取消」按钮） |
| `restoreAll` | `restoreAll(): Promise<void>` | 刷新续查：把所有 `running` 状态的节点接回来 |

`run` 的 `input` 形状：`{ prompt?: string; values?: Record<string, unknown>; resources?: ToolResource[] }`。

## 一个真实调用

FJ => FJts
// 位置：底栏组件里 —— 用户点了某个动作
  const bar = ctx.get('nodeBar')
  const action = bar.get('image.rotate')
  await ctx.get('canvas').runBarAction(nodeId, 'image.rotate', {})
FJ => FJ

## 注意事项

1. **`run` 返回的是"最终结果"**：调用方不必再去读节点 data。
2. **`restoreAll` 的时机很讲究**（源码里有长注释）：`ctx:ready` 时画布数据**还没**从 storage 恢复进来，光靠它扫不到 running 节点。所以它订阅了 `doc` 变化、等"文档真有内容"再续查（扫到就锁死），另加 `ctx:ready` 与 `ctx:plugin-installed` 两条兜底（都幂等）。
3. **续查出来的任务也要登记 `AbortController`**：不登记的话 `cancel` 拿不到控制器 → 点了取消什么都没发生（用户实测反馈过）。

> `nodeTask` 是 bottom-bar 插件自己上架的执行器，不算基础服务。别的插件跑动作统一走
> `ctx.get('canvas').runBarAction(...)` / `cancelBarAction(...)`；底栏自己的组件仍可直接用内部服务名。

