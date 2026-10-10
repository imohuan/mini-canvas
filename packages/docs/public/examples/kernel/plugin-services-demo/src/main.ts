// 文件：packages/docs/public/examples/kernel/plugin-services-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把提供方与两个消费方装进同一个内核
import { Context } from '@mini-canvas/kernel'
import { GreeterService } from './greeterService'
import { consumerPlugin } from './consumerPlugin'
import { optionalPlugin } from './optionalPlugin'

const ctx = new Context({ dev: true })  // ① 建

ctx.plugin(consumerPlugin)              // ② 故意先装依赖方：顺序无所谓，框架会排
ctx.plugin(optionalPlugin)
ctx.plugin(GreeterService)              //    装提供方（类形态）

await ctx.start()                       // ③ 启：多轮激活，consumer 等 greeter 就绪后才跑

console.log('[main] 插件状态：', ctx.inspectPlugins().map((p) => `${p.name}=${p.state}`).join(', '))

ctx.uninstallPlugin('greeter')          // ④ 热卸提供方
console.log('[main] 卸完 greeter 后，服务还在吗：', !!ctx.get('greeter'))
console.log('[main] consumer 现在：', ctx.inspectPlugins().find((p) => p.name === 'consumer')?.state)

ctx.stop()

