// 文件：packages/docs/public/examples/viewport/plugin-camera-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'

export const name = 'camera-demo'

// ① 硬依赖：没有 view 服务（几何 + 视口）这个插件没意义（框架会让它等渲染宿主就绪）
export const inject = ['view', 'selection'] as string[]

export function apply(ctx: Context): void {
  const view = ctx.get('view')
  const selection = ctx.get('selection')

  // ② 记忆槽：本插件自己存"上次保存的镜头位置"
  let savedView: { x: number; y: number; zoom: number } | null = null

  ctx.commands.register({
    id: 'camera-demo:focus-100',
    title: '100% 聚焦选中节点',
    group: 'camera-demo',
    keys: ['mod+alt+f'],
    when: () => selection.ids.size > 0,
    run() {
      const id = [...selection.ids][0]
      const rect = view.getNodeRect(id)       // ③ 实测矩形（见 view 那篇）
      if (!rect) return false
      // ④ 把节点中心放到视野中心，并强制缩放到 100%
      view.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, 1)
      return true
    },
  })

  ctx.commands.register({
    id: 'camera-demo:save-view',
    title: '记住当前镜头',
    group: 'camera-demo',
    run() {
      // ⑤ 读当前视口，自己留一份（这只是演示用的内存记忆；要跨刷新就存进 save）
      savedView = view.getViewport()
      return savedView
    },
  })

  ctx.commands.register({
    id: 'camera-demo:restore-view',
    title: '跳回记住的镜头',
    group: 'camera-demo',
    when: () => savedView !== null,
    run() {
      if (!savedView) return false
      // ⑥ 一次性取景动作 → 用带过渡的那条（后端不支持动画时自动退回即时）
      view.animateViewport(savedView, 320)
      return true
    },
  })

  // ⑦ 演示坐标换算：把"屏幕左上角"翻译成画布坐标打出来（挂在一个命令上，方便手动试）
  ctx.commands.register({
    id: 'camera-demo:log-corner',
    title: '打印屏幕左上角对应的画布坐标',
    group: 'camera-demo',
    run() {
      const pane = view.getPaneEl()
      if (!pane) return false
      const box = pane.getBoundingClientRect()
      const pt = view.screenToFlow(box.left, box.top)
      console.log('[camera-demo] 视口', view.getViewport(), 'pane 左上角在画布坐标', pt)
      return pt
    },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const cameraDemoPlugin: PluginModule = { name, inject, apply }

