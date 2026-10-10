// 文件：packages/docs/public/examples/kernel/plugin-services-demo/src/optionalPlugin.ts
// 格式：TypeScript 模块（插件入口，但依赖是可选的）
// 位置：插件包里「有就用、没有就算了」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'
import type { GreeterService } from './greeterService'

export const name = 'optional'
export const inject = [] as string[]            // ① 不写 greeter：它不是硬依赖

export function apply(ctx: Context): void {
  // ② 可选探测：缺服务返回 undefined，不抛
  const greeter = ctx.get<GreeterService>('greeter')
  const byTry = ctx.tryGet<GreeterService>('greeter')
  console.log('[optional] greeter 在不在：', !!greeter, '（tryGet 一样：', !!byTry, '）')
  if (greeter) console.log('[optional]', greeter.greet('optional'))
}

export const optionalPlugin: PluginModule = { name, inject, apply }

