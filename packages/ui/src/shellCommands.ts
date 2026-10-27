/**
 * 外壳命令：让抽屉槽里的按钮不必反向 import @mini-canvas/ui。
 *
 * 为什么走命令而不是新服务：这三件事都是“动作”，项目现有快捷键/右键菜单
 * 也统一走命令表；新增一个全局 shell 服务只会多一个服务名。
 */
import type { Context } from '@mini-canvas/canvas-data'

export interface ShellCommandHost {
  /** 打开左侧抽屉，保留当前页签。 */
  showLeftDrawer(): void
  /** 打开左侧抽屉并切到指定页签。 */
  openDrawerTab(id: string): void
  /** 收起/展开左侧抽屉。 */
  toggleLeftCollapsed(): void
}

/** 注册三条外壳命令；返回的 disposer 由装配层在卸载时回收。 */
export function registerShellCommands(
  ctx: Context,
  host: ShellCommandHost,
): Array<{ dispose(): void }> {
  return [
    ctx.commands.register({
      id: 'shell:open-drawer',
      title: '打开左侧抽屉',
      run: () => host.showLeftDrawer(),
    }),
    ctx.commands.register({
      id: 'shell:open-drawer-tab',
      title: '打开左侧抽屉页签',
      run: (_ctx, payload) => {
        const id = (payload as { id?: unknown } | undefined)?.id
        if (typeof id === 'string' && id) host.openDrawerTab(id)
      },
    }),
    ctx.commands.register({
      id: 'shell:toggle-drawer',
      title: '收起或展开左侧抽屉',
      run: () => host.toggleLeftCollapsed(),
    }),
  ]
}
