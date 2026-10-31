// 文件：packages/docs/public/examples/plugin-manager/plugin-installer-demo/src/demoTarget.ts
// 格式：TypeScript 模块（一个很小的插件，导出 name / apply）
// 位置：本示例的"装卸靶子"——由管理面板经 host.manager.install 装上、uninstall 卸下
import type { Context, PluginModule } from '@mini-canvas/canvas-base'

export const name = 'installer-demo-target'

/**
 * 装上去时注册一条命令（用来确认"真的装上了"）；
 * 卸载时框架会自动回收它注册的一切——插件作者不用写 uninstall。
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    id: 'installer-demo-target:hello',
    title: '靶子插件说你好',
    run() {
      console.log('[installer-demo-target] 我还活着，说明插件确实装上了')
      return true
    },
  })
  console.log('[installer-demo-target] 已装载')
}

export const demoTargetPlugin: PluginModule = { name, apply }

