// 文件：packages/docs/public/examples/kernel/plugin-hello/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把三种形态的插件装进同一个内核
import { Context } from '@mini-canvas/kernel'
import * as helloPlugin from './index'
import { GreeterService } from './greeterPlugin'
import { heartbeat } from './heartbeatPlugin'

const ctx = new Context({ dev: true })   // ① 建

ctx.plugin(helloPlugin)                  // ② 装：对象形态（整个模块就是插件）
ctx.plugin(GreeterService)               //    装：类形态（直接传类）
ctx.plugin(heartbeat)                    //    装：函数形态（直接传函数）
ctx.plugin({                             //    装：消费方，硬依赖 greeter 服务
  name: 'consumer',
  inject: ['greeter'],
  apply(c) {
    // inject 保证了 apply 跑的时候 greeter 已就绪
    console.log('[consumer]', c.get<GreeterService>('greeter').greet('world'))
  },
})

await ctx.start()                        // ③ 启：多轮激活 + 广播 ctx:ready
ctx.emit('ping')                         // 广播一个自定义事件（dev 下未登记会 warn）

console.log(ctx.get<GreeterService>('greeter').greet('kernel'))
console.log(ctx.inspectPlugins().map((p) => `${p.name}:${p.state}`).join(' '))

ctx.stop()                               // ④ 停：倒序清光，可重新 start

