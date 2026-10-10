// 文件：packages/docs/public/examples/kernel/plugin-services-demo/src/consumerPlugin.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：插件包里「依赖方」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'consumer'
export const inject = ['greeter'] as string[]   // ① 硬依赖：greeter 没就绪，本插件停在 pending

export function apply(ctx: Context): void {
  // ② 走到这里，框架已保证 greeter 在（inject 编排过了）
  const greeter = ctx.get('greeter')            // 类型自动推导成 GreeterService（文件一登记过）
  console.log('[consumer]', greeter.greet('world'))

  // ③ 属性直读糖：与上一行运行时等价（插件 ctx 专属）
  console.log('[consumer]', ctx.greeter.greet('proxy'))
}

export const consumerPlugin: PluginModule = { name, inject, apply }

