// 文件：packages/docs/public/examples/plugin-manager/plugin-installer-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口——演示 pluginManager 的装 / 卸 / 诊断
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import InstallerPanel from './InstallerPanel.vue'

export const name = 'installer-demo'

// ① 本插件的管理面板在"没有 pluginManager"时也能显示一句提示，属于可选依赖（用 tryGet 探测）
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ② 可选探测：拿不到就什么都不挂（宿主没起渲染层时不至于整块崩）
  const manager = ctx.tryGet('pluginManager')
  if (!manager) {
    console.warn('[installer-demo] 没有 pluginManager 服务（宿主未起渲染层），管理面板不挂载')
    return
  }

  // ③ 挂管理面板。注意：槽位组件不接收自定义 props ——
  //    面板自己用 useCanvasRender() → ctx.get('pluginManager') 取服务（与真实插件同款做法）。
  ctx.slots.register('overlay', {
    id: 'installer-demo/panel',
    order: 60,
    component: InstallerPanel,
    meta: { title: '插件装卸演示' },
  })

  // ④ 顺手打一份诊断：谁卡住了、缺什么依赖，一眼可见
  const bad = manager.diagnose()
  if (bad.length > 0) {
    console.warn('[installer-demo] 这些插件没在正常跑：', bad)
  }
}

/** 兼容旧装配的 PluginModule 出口 */
export const installerDemoPlugin: PluginModule = { name, inject, apply }

