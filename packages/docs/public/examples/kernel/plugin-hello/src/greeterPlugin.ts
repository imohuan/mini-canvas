// 文件：packages/docs/public/examples/kernel/plugin-hello/src/greeterPlugin.ts
// 格式：TypeScript 模块（类形态插件）
// 位置：插件包里「提供一项服务」的那一件
import { Service, type Context } from '@mini-canvas/kernel'

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter') // 上架服务名 'greeter'；卸载随插件自动撤下
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}

