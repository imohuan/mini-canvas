/**
 * cordis 原文逐字抄 · 编译期证明（能力①②③ 的作者侧合并缝）。
 *
 * 本文件不被运行/不导出运行逻辑，只为了被 canvas-base 包的 tsc 全量编译，证明作者照 cordis 教程：
 *   declare module '@mini-canvas/canvas-core-v2' { interface Context/interface Events }
 * 后 `ctx.greeter` 与类型化 `ctx.on/ctx.emit` 都能编译通过（合并缝真实生效）。
 */
import { Service } from './index'
import type { Context } from './index'
import type {} from '@mini-canvas/canvas-core-v2'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    greeter: GreeterService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

/** 照 cordis 03：Service 子类即插件，构造 super(ctx,'greeter') 上架服务 */
export class GreeterService extends Service {
  static inject = [] as string[]
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }
  greet(who: string) {
    return `Hello, ${who}!`
  }
}

/** 照 cordis 03 consumer：inject 后 ctx.greeter 直访（能力②类型通） */
export function cordisConsumer(ctx: Context): void {
  // 能力②：ctx.greeter 类型为 GreeterService（经上面 declare module 合并）
  const hi: string = ctx.greeter.greet('world')
  void hi
}

/** 照 cordis 04：declare Events 后 ctx.on/ctx.emit 参数类型化（能力③） */
export function cordisEvents(ctx: Context): void {
  ctx.on('stats/report', (name, count) => {
    name.toUpperCase() // string ok
    count.toFixed() // number ok
  })
  ctx.emit('stats/report', 'tool_call', 1)
  // @ts-expect-error 参数量被 Events 约束（少一个 → 编译错）
  ctx.emit('stats/report', 'tool_call')
}
