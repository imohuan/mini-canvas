// 文件：packages/docs/public/examples/theme-registry/plugin-demo-theme/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / apply）
// 位置：一个可安装插件包的源码入口

import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import GridBackground from './GridBackground.vue'

export const name = 'demo-theme'

/**
 * 不需要 inject：ctx.theme 自己会去找 themeRegistry（找不到就跳过容器写入），
 * 装载期也不会因为缺服务而停在 PENDING。
 */
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ① 顶替默认背景：默认皮那件是 order 0，这里给 -1（更小 = 更优先 = 赢家）
  ctx.theme.register('background', GridBackground, { id: 'demo-grid', order: -1 })

  // ② 不用写清理：语法糖把撤销登记进本插件作用域，
  //    卸载后这件从 background 槽消失，默认皮的背景自动回来。
}

/** 兼容旧装配的 PluginModule 出口 */
export const demoThemePlugin: PluginModule = { name, inject, apply }

