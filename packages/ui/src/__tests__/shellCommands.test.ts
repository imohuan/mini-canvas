/**
 * 外壳命令契约。
 *
 * 外壳按钮不能反向 import UI 的状态，所以“打开抽屉 / 切页签 / 收起展开”走命令表。
 * 这里锁三条命令真的落到宿主提供的动作上。
 */
import { describe, expect, it } from 'vitest'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { registerShellCommands } from '../shellCommands'

describe('shell 命令', () => {
  it('打开抽屉 / 切页签 / 收起展开都走命令', async () => {
    const { host } = await createMiniCanvasHost({ adapter: new MemoryStorageAdapter() })
    const calls: string[] = []
    const disposers = registerShellCommands(host.ctx, {
      showLeftDrawer: () => calls.push('open'),
      openDrawerTab: (id) => calls.push('tab:' + id),
      toggleLeftCollapsed: () => calls.push('toggle'),
    })

    host.command.execute('shell:open-drawer')
    host.command.execute('shell:open-drawer-tab', { id: 'inspiration' })
    host.command.execute('shell:toggle-drawer')

    expect(calls).toEqual(['open', 'tab:inspiration', 'toggle'])
    for (const d of disposers) d.dispose()
    host.stop()
  })
})
