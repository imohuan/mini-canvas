# ctx.jobs · 后端定时任务

**一句话定位**：`ctx.jobs` 是插件自己的**定时 / 延时任务 / 事件订阅**；注册随插件卸载自动回收。

**属于哪一档**：后台框架能力段（`packages/cloud-server/src/serverFramework/jobs.ts`）。

## 用法

```js
// 文件：<数据根>/server-plugins/demo-jobs.js
export const name = 'demo-jobs'

export function apply(ctx) {
  const handle = ctx.jobs.every(5000, () => console.log('[demo] tick'))
  ctx.jobs.once(1000, () => console.log('[demo] 一秒后跑一次'))
  ctx.jobs.on('ctx:plugin-installed', ({ name }) => console.log('[demo] 装了', name))
  // handle.cancel() 可手动停；不调也会在插件卸载时自动清
}
```

## 方法

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `every` | `every(intervalMs: number, fn: () => void \| Promise<void>): JobHandle` | 每 intervalMs 跑一次（首次不立即跑） |
| `once` | `once(delayMs: number, fn: () => void \| Promise<void>): JobHandle` | 延时跑一次 |
| `soon` | `soon(fn: () => void \| Promise<void>): JobHandle` | 下一拍跑一次（= `once(50, fn)`） |
| `on` | `on(event: string, fn: (...args: unknown[]) => void): JobHandle` | 订阅一个内核事件 |

`JobHandle` 只有一个方法：`cancel(): void`（幂等）。

## 注意事项

1. **最小间隔 50ms**：`intervalMs` 小于它（或非有限数）会被夹到 50，防插件写出 1ms 死循环把 CPU 打满。
2. **单个任务抛错不把定时器带崩**：`job` 内部包了 try/catch，出错记一条 warn、继续跑。
3. **进程内、不持久化**：这是轻量调度，不是任务队列 —— 进程重启就没了。需要跨重启的任务用任务系统（`/api/jobs`），不是这里。
4. **`on(event, fn)` 的订阅随插件卸载解除**（`ctx.on` 本来就挂在插件 fiber 上）。

