// 文件：packages/docs/public/examples/kernel/plugin-scope-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / apply）
// 位置：演示「作者不写 uninstall」的四种副作用
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'scope-demo'

export function apply(ctx: Context): void {
  // ① 定时器：返回清理函数 → 自动入袋
  ctx.effect(() => {
    const timer = setInterval(() => console.log('[scope-demo] tick'), 1000)
    return () => {
      clearInterval(timer)
      console.log('[scope-demo] 定时器已清')
    }
  })

  // ② 事件监听：订阅自动登记进本插件 fiber（不用接返回值）
  ctx.on('ping', () => console.log('[scope-demo] pong'))

  // ③ 注册场条目：放置随本插件回收（source 会写成本插件名）
  ctx.registryOf<{ note: string }>('scope-demo/things').add('one', { note: '我在场里' })

  // ④ 上架服务：卸载自动撤下
  ctx.provide('scopeDemoClock', { now: () => Date.now() })

  // ⑤ 私有状态：卸载后 value 清空，状态不再可达
  const counter = ctx.state({ n: 0 })
  counter.value.n += 1

  console.log('[scope-demo] 装载完成，四种副作用都登记好了')
}

// ⑥ 一个手写 cleanup 都不需要 —— 全交给框架
export const scopeDemoPlugin: PluginModule = { name, apply }

