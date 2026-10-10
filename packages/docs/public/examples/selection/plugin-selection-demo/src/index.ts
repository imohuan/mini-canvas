// 文件：packages/docs/public/examples/selection/plugin-selection-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import SelectionBadge from './SelectionBadge.vue'

export const name = 'selection-demo'

// ① 硬依赖写进 inject：框架保证 apply 运行时这两个服务已就绪；
//    缺提供方时插件停在 PENDING（而不是 apply 里拿到 undefined 再炸）
export const inject = ['doc', 'selection'] as string[]

export function apply(ctx: Context): void {
  const selection = ctx.get('selection')
  const doc = ctx.get('doc')

  // ② 订阅名单变化。注意订阅返回的是"取消订阅"函数，
  //    登记进 ctx.effect 后，插件卸载时自动取消——不用手写 uninstall。
  const off = selection.onChange(() => {
    console.log(
      '[selection-demo] 现在选中：节点',
      [...selection.ids],
      '边',
      [...selection.edgeIds],
    )
  })
  ctx.effect(() => () => off())

  // ③ 命令：把"没被选中的节点"选起来（反选）。
  //    经 ctx.commands.register = 注册场那条路：条目归本插件，卸载自动摘除。
  ctx.commands.register({
    id: 'selection-demo:invert',
    title: '反选节点',
    run() {
      const allIds = doc.getNodes().map((n) => n.id)
      const next = allIds.filter((id) => !selection.has(id)) // ④ 逐个问 has
      selection.set(next)                                    // ⑤ 一次性替换
      return next.length
    },
  })

  // ⑥ 往 overlay 槽挂一个徽章组件（宿主 CanvasSurface 用 <SlotHost slot="overlay"> 渲染它）
  ctx.slots.register('overlay', {
    id: 'selection-demo/badge',
    order: 20,
    component: SelectionBadge,
    meta: { title: '选中计数' },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const selectionDemoPlugin: PluginModule = { name, inject, apply }

