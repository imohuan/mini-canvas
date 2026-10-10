// 文件：packages/docs/public/examples/kernel/plugin-config-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：演示「只给一部分 config，其余补默认」与「越界响亮报错」
import { Context } from '@mini-canvas/kernel'
import { configDemoPlugin } from './index'

// ① 正常装配：只给一项，其余全走默认
const ctx = new Context({ dev: true })
ctx.plugin(configDemoPlugin, { configDemoWidth: 6 })
await ctx.start()
ctx.stop()

// ② 故意越界：fiber 进 failed，错误从 start() 抛出来
const bad = new Context()
bad.plugin(configDemoPlugin, { configDemoWidth: 999 })
try {
  await bad.start()
} catch (err) {
  console.log('[main] 响亮报错：', (err as Error).message)
  // → [config] invalid config: "configDemoWidth" = 999 exceeds max 12
}
console.log('[main] 该插件状态：', bad.inspectPlugins()[0]?.state)   // 'failed'

