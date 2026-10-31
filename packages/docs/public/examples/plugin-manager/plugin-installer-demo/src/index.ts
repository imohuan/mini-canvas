// 文件：packages/docs/public/examples/plugin-manager/plugin-installer-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口——演示 host.manager 的装 / 卸 / 诊断
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import InstallerPanel from './InstallerPanel.vue'

export const name = 'installer-demo'

// ① 面板自己在渲染子树里取 host.manager；apply 阶段拿不到宿主句柄
export const inject = [] as string[]

export function apply(ctx: Context): void {
  // ② 挂管理面板。槽位组件不接收自定义 props ——
  //    面板自己用 useCanvasRender().host.manager 取安装句柄。
  ctx.slots.register('overlay', {
    id: 'installer-demo/panel',
    order: 60,
    component: InstallerPanel,
    meta: { title: '插件装卸演示' },
  })

  // ③ 挂完即可；诊断在面板首次挂载后读 host.manager.diagnose()。
}

/** 兼容旧装配的 PluginModule 出口 */
export const installerDemoPlugin: PluginModule = { name, inject, apply }

