// 文件：packages/docs/public/examples/kernel/plugin-capability-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：演示「装层 / 不装层」两种结果
import { Context } from '@mini-canvas/kernel'
import { createMiniCapabilityLayer } from './miniLayer'

/** 段不参与框架类型，演示里用局部类型把它说清楚 */
type WithNotes = { notes: { add(t: string): void; list(): string[] } }

// ① 装层：显式传实例
const withLayer = new Context({ capabilityLayer: createMiniCapabilityLayer() })
withLayer.plugin({
  name: 'writer',
  apply(ctx) {
    const c = ctx as unknown as WithNotes
    c.notes.add('第一条笔记')                                  // ctx.notes 是层产出的段
    console.log('[writer] 笔记：', c.notes.list())
  },
})
withLayer.plugin({
  name: 'reader',
  apply(ctx) {
    console.log('[reader] clock 能取到吗：', !!ctx.get('clock'))    // true（层的内置服务）
    console.log('[reader] 我的笔记（逐插件隔离）：', (ctx as unknown as WithNotes).notes.list())  // []
  },
})
await withLayer.start()
withLayer.stop()                        // 触发层的 reset()

// ② 不装层：纯插件内核，段不存在、内置服务也不存在
const bare = new Context()
bare.plugin({
  name: 'probe',
  apply(ctx) {
    console.log('[probe] 没有层时 clock：', ctx.get('clock'))                       // undefined
    console.log('[probe] 没有层时 notes：', (ctx as unknown as { notes?: unknown }).notes)  // undefined
  },
})
await bare.start()
bare.stop()

// ③ 也可以装成全局默认：之后每次 new Context() 各拿一份新层
// import { setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
// setDefaultCapabilityLayerFactory(() => createMiniCapabilityLayer())

