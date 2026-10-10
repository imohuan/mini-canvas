// 文件：packages/docs/public/examples/tools/plugin-tool-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
//
// 插件形态用的是仓库统一的"裸导出三样"：name + inject + apply。
// 装载方式（宿主侧，一行）：plugins: [toolDemoPlugin]

import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { countTool, reverseTool } from './demoTools'

export const name = 'tool-demo'

/** ① 硬依赖：tools 是内核内置服务，写进 inject 表明"没有它我不跑" */
export const inject = ['tools'] as string[]

export function apply(ctx: Context): void {
  // ② 注册工具。ctx.tools.register 的撤销已经自动登记进本插件作用域：
  //    插件卸载时这两个工具自动从名册消失，作者不用手写 unregister。
  ctx.tools.register(reverseTool())
  ctx.tools.register(countTool())

  // ③ 自检：注册完马上核对一遍（真实插件里通常不写，这里演示怎么验）
  console.log('[tool-demo] 已注册：', ctx.tools.list({ group: '演示' }).map((t) => t.name))
}

/** 兼容旧装配的 PluginModule 出口 */
export const toolDemoPlugin: PluginModule = { name, inject, apply }

