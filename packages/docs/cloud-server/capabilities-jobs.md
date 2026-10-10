# 能力详解 · jobs：定时与延时任务

**一句话定位**：`ctx.jobs` 让插件「每隔几分钟做点什么」「5 秒后做点什么」「有事发生时做点什么」—— 注册即挂插件作用域，卸载时定时器统一清掉，不留幽灵定时器。

## 这篇能让你做什么

- 写周期任务（轮询外部平台、清理缓存、心跳打点）；
- 写延时任务和事件订阅；
- 明白它的边界：进程内轻量调度，进程重启任务就没了。

## 完整代码

```js
// 文件：<数据根>/server-plugins/demo-jobs.js
// 格式：自包含单文件后台插件
// 作用：演示 every / once / soon / on 四个方法

export const name = 'demo-jobs'

export function apply(ctx) {
  // ① 周期任务：每 60 秒跑一次（首次等一个周期，不立即跑）
  const handle = ctx.jobs.every(60000, () => {
    console.log('[demo-jobs] 心跳', new Date().toISOString());
  });

  // ② 想提前停：handle.cancel()（幂等，重复调不报错）
  ctx.routes.post('/api/demo-jobs/stop', (c) => {
    handle.cancel();
    return c.json({ ok: true, stopped: true });
  });

  // ③ 延时任务：5 秒后跑一次
  ctx.jobs.once(5000, () => console.log('[demo-jobs] 启动 5 秒后的延时任务'));

  // ④ 事件订阅：有插件被热装时收到通知（订阅随卸载自动解除）
  ctx.jobs.on('ctx:plugin-installed', (payload) => {
    console.log('[demo-jobs] 有插件装上来了', payload);
  });
}
```

验证：装上插件看控制台每 60 秒一条心跳；POST stop 后心跳停止。

## 每一步在干什么

- **① `every(intervalMs, fn)`**：返回 `{ cancel() }` 句柄。**最小间隔 50ms** —— 传更小的值会被框架抬到 50（防 1ms 死循环打满 CPU）。回调抛错只记一条日志，不会把定时器带崩。
- **② `once(delayMs, fn)` / `soon(fn)`**：延时一次 / 下一拍就跑。`soon` 内部就是 `once(50, fn)`。
- **③ `on(event, fn)`**：订阅内核事件（如 `ctx:plugin-installed`）。ctx.on 的订阅本来就随插件 fiber 回收，这里只是包成句柄形状。
- **④ 回收保证**：本插件登记的所有定时器记在一个 Set 里，插件作用域回收时统一 `clearInterval` / `clearTimeout` —— 你不用手写任何清理代码。
- **⑤ 边界（重要）**：这是**进程内**轻量调度，**不是持久化任务队列** —— 进程重启，every / once 的任务就没了。要跨重启的正式任务（生成、下单）用任务系统（`/api/jobs`），别在这里硬扛。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 四方法 | `packages/cloud-server/src/serverFramework/jobs.ts` 的 `JobsRegistrar` | every / once / soon / on |
| 最小间隔 50ms | 同上 `MIN_INTERVAL_MS` + `guard()` | Number.isFinite 校验 + 低于 50 抬到 50 |
| 回收定时器 | 同上 `ctx.effect(() => () => { for (const t of timers) ... })` | Set 里全部清掉 |
| 回调抛错容错 | 同上 `wrap()` | try/catch + Promise.catch，console.warn 不炸定时器 |
| 句柄 cancel 幂等 | 同上 `every` / `once` 的 cancel | `if (!timers.has(t)) return` |
| 事件订阅 | 同上 `on(event, fn)` | `ctx.on` 包成 JobHandle，dispose 即取消 |
| 不是持久化队列 | 同上文件头「边界」注释 | 「进程重启就没了 —— 需要跨重启的任务应该用任务系统」 |

## 常见坑

1. **期望 every 立即跑第一次**：不会 —— 首次等一个完整周期。想「先跑一次再周期跑」，在 every 之前先 `ctx.jobs.soon(fn)`。
2. **把重启后要恢复的活儿写在 jobs 里**：进程重启任务蒸发。真正的业务任务走 `/api/jobs`（有落盘、有查单、有撤单）。
3. **周期任务里抛异步错没人管**：框架会把 rejected promise 记成 warn，但业务错误还是要自己在回调里处理（写日志 / 落 store）。
4. **intervalMs 传 0 或负数**：被抬到 50ms，不是报错 —— 想清楚你要的是 50ms 还是报错提醒。
5. **定时器句柄丢了没法停**：every 的返回值就是句柄，自己存好（showcase 存在内存 state 里供 DELETE 接口调用）。
