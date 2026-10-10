// 文件：packages/docs/public/examples/kernel/plugin-scope-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：验证「热卸之后一个不留」
import { Context } from '@mini-canvas/kernel'
import { scopeDemoPlugin } from './index'

const ctx = new Context({ dev: true })
await ctx.start()

// ① 热装
ctx.installPlugin(scopeDemoPlugin)
ctx.emit('ping')                                                  // → [scope-demo] pong
console.log('服务在不在：', !!ctx.get('scopeDemoClock'))            // true
console.log('场里有没有：', ctx.registryOf('scope-demo/things').has('one'))  // true

// ② 热卸：一次调用，四种副作用全部自动回收
ctx.uninstallPlugin('scope-demo')

// ③ 检查
console.log('服务在不在：', !!ctx.get('scopeDemoClock'))            // false
console.log('场里有没有：', ctx.registryOf('scope-demo/things').has('one'))  // false
// 监听也一并摘掉了：根 Context 的 bus 是公开字段（平时用不到，诊断/测试很方便）
console.log('监听还在吗：', ctx.bus.has('ping'))                     // false
// 并且控制台会打印一次「定时器已清」—— 那是 ctx.effect 登记的清理函数跑了

ctx.stop()

