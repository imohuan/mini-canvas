// 文件：packages/docs/public/examples/kernel/plugin-model-tool-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：注册 → 调用 → 看事件
import { Context, runToolCall, TOOL_KIND, type ToolSpec } from '@mini-canvas/kernel'
import { modelToolLoggerPlugin } from './toolLogger'
import { modelToolProviderPlugin } from './toolProvider'

const ctx = new Context({ dev: true })

ctx.plugin(modelToolLoggerPlugin)     // ① 先装观察者（这样「进表」事件也能收到）
ctx.plugin(modelToolProviderPlugin)   //    再装提供方
await ctx.start()

// ② 取同一张场来调工具（field 决定「用哪张表」，与 ctx.tools 无关）
const field = ctx.registryOf<ToolSpec>(TOOL_KIND)

// ③ 正常调用：参数、产物都对
const r1 = await runToolCall(field, ctx, { name: 'greet', arguments: { name: '世界', excited: true } })
console.log('[main] greet →', r1.ok, r1.content)

// ④ 参数校验失败：缺 required，收敛成 ok:false（不抛）
const r2 = await runToolCall(field, ctx, { name: 'greet', arguments: {} })
console.log('[main] 缺参数 →', r2.ok, r2.error)

// ⑤ 显式给 callId + 取消信号
const ac = new AbortController()
const r3 = await runToolCall(field, ctx, { name: 'double', arguments: { n: 21 }, callId: 'demo-1', signal: ac.signal })
console.log('[main] double →', r3.callId, r3.value)

// ⑥ 调用前就取消：直接返回失败
ac.abort()
const r4 = await runToolCall(field, ctx, { name: 'double', arguments: { n: 1 }, signal: ac.signal })
console.log('[main] 已取消 →', r4.ok, r4.error)   // false 调用已取消

// ⑦ 找不到工具
const r5 = await runToolCall(field, ctx, { name: 'ghost' })
console.log('[main] 找不到 →', r5.ok, r5.error)   // false 未找到工具 "ghost"

ctx.stop()

