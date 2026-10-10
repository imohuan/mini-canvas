// 文件：packages/docs/public/examples/kernel/plugin-events-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：把喊话方与两个听众装进同一个内核
import { Context } from '@mini-canvas/kernel'
import { handlerPlugin } from './handlerPlugin'
import { listenerPlugin } from './listenerPlugin'
import { speakerPlugin } from './speakerPlugin'

const ctx = new Context({ dev: true })   // ① dev: true → 未登记事件名会 warn

// ② 未登记的自定义事件名：dev 下 console.warn 一次（不影响运行）
ctx.emit('demo:not-registered', 1)

// ③ 注册序决定 serial 的询问顺序：listener 先、handler 后
ctx.plugin(speakerPlugin)
ctx.plugin(listenerPlugin)
ctx.plugin(handlerPlugin)

await ctx.start()
ctx.stop()

