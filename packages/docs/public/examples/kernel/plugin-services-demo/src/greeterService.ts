// 文件：packages/docs/public/examples/kernel/plugin-services-demo/src/greeterService.ts
// 格式：TypeScript 模块（类形态插件：提供并上架一个服务）
// 位置：插件包里「提供方」的那一件
import { Service, type Context } from '@mini-canvas/kernel'

declare module '@mini-canvas/kernel' {
  interface Services {
    greeter: GreeterService           // ① 类型登记：ctx.get('greeter') 从此自带类型
  }
}

export class GreeterService extends Service {
  static provide = 'greeter'          // ② 插件名与服务名都用它（asPluginModule 读静态 provide）
  constructor(ctx: Context) {
    super(ctx)                        // 不传 name → 取静态 provide，等价于 super(ctx, 'greeter')
  }
  greet(who: string): string {
    return `Hello, ${who}!`
  }
}

