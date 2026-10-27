/**
 * 抽屉页签的共享状态契约。
 *
 * 用户口径（2026-10-27）：收起再展开不能莫名其妙跳回“画布”；
 * 外壳按钮要能通过统一入口打开指定页签。这里锁这两条行为。
 */
import { describe, expect, it } from 'vitest'
import { useUi } from '../composables/ui'

describe('抽屉页签状态', () => {
  it('openDrawerTab 打开抽屉并切页签', () => {
    const ui = useUi()
    ui.state.drawer = null
    ui.openDrawerTab('inspiration')
    expect(ui.state.drawer).toBe('left')
    expect(ui.state.leftTab).toBe('inspiration')
  })

  it('收起再展开保留上次页签', () => {
    const ui = useUi()
    ui.state.leftTab = 'inspiration'
    ui.state.leftCollapsed = false
    ui.state.drawer = 'left'
    ui.toggleLeftCollapsed()
    expect(ui.state.drawer).toBe(null)
    ui.toggleLeftCollapsed()
    expect(ui.state.drawer).toBe('left')
    expect(ui.state.leftTab).toBe('inspiration')
  })
})
