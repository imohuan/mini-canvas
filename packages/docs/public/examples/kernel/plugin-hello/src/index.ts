// 文件：packages/docs/public/examples/kernel/plugin-hello/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context } from '@mini-canvas/kernel'

export const name = 'hello'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 监听内核内置事件：启动完成时打一声招呼
  ctx.on('ctx:ready', ({ plugins }) => {
    console.log('[hello] 就绪，本批激活：', plugins.join(', '))
  })
}

