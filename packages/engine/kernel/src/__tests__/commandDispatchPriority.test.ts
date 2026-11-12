/**
 * 快捷键分发优先级 —— findCommandByKeys 的"让位"语义契约。
 *
 * 背景（用户要求）：节点要自己的快捷键（如 3D 预览的 f=全屏 / r=重置），
 * 但 f / r 已被自动布局插件注册（聚焦选中 / 适应视图）。用户原话：
 * "注意这里画布也可能注册了 f，你需要有一个优先级，选中节点之后支持这些快捷键"。
 *
 * 于是分发要有两条规则，本文件就是把它钉死：
 * 1. **when 不满足 = 让位**：该命令此刻不该接管这个键，同键的其它命令仍有机会（
 *    而不是"命中即吃掉、结果执行时被 when 拦成空操作"——那样全局快捷键就被节点命令挤没了）；
 * 2. **order 小的赢**：同键多个命令都可用时，按 order 定优先级（越小越优先）；
 *    order 相同才回落到注册先后（保持既有行为不变）。
 */
import { describe, it, expect } from 'vitest'
import { findCommandByKeys } from '../command'

type Cmd = { id: string; keys?: string[]; order?: number; when?: (ctx: unknown) => boolean }

describe('when 不满足 → 让位给同键的其它命令', () => {
  const ctxWithNode = { hasNode: true }
  const cmds: Cmd[] = [
    // 画布全局：f 聚焦选中（没有 when，任何时候都可用），order 20
    { id: 'auto-layout:focus-selected', keys: ['f'], order: 20 },
    // 节点级：f 全屏（只有"选中了 3D 节点"时可用），优先级更高
    { id: '3d-preview:fullscreen', keys: ['f'], order: 5, when: (ctx) => (ctx as typeof ctxWithNode).hasNode },
  ]

  it('节点选中（when 为真）→ 节点命令赢（order 更小）', () => {
    expect(findCommandByKeys(cmds, { key: 'f' }, ctxWithNode)?.id).toBe('3d-preview:fullscreen')
  })

  it('没选中该节点（when 为假）→ 让位给画布命令，而不是吃掉变成空操作', () => {
    expect(findCommandByKeys(cmds, { key: 'f' }, { hasNode: false })?.id).toBe('auto-layout:focus-selected')
  })

  it('没传 ctx（老调用方）→ 不评估 when，仍按 order 选出最优先的那个', () => {
    expect(findCommandByKeys(cmds, { key: 'f' })?.id).toBe('3d-preview:fullscreen')
  })

  it('when 为假的命令完全被跳过：同键没有别人时返回 undefined（不是返回一个不可用的命令）', () => {
    const alone: Cmd[] = [{ id: 'only', keys: ['f'], when: () => false }]
    expect(findCommandByKeys(alone, { key: 'f' }, {})).toBeUndefined()
  })
})

describe('order 优先级', () => {
  it('同键多个命令：order 小的赢', () => {
    const cmds: Cmd[] = [
      { id: 'late', keys: ['k'], order: 90 },
      { id: 'early', keys: ['k'], order: 10 },
    ]
    expect(findCommandByKeys(cmds, { key: 'k' })?.id).toBe('early')
  })

  it('order 相同（或都没写）→ 保持注册先后（既有行为不变）', () => {
    const cmds: Cmd[] = [
      { id: 'first', keys: ['k'] },
      { id: 'second', keys: ['k'] },
    ]
    expect(findCommandByKeys(cmds, { key: 'k' })?.id).toBe('first')
  })

  it('优先级只在"同键命中"之间比较，不影响别的键', () => {
    const cmds: Cmd[] = [
      { id: 'f-node', keys: ['f'], order: 5 },
      { id: 'r-canvas', keys: ['r'], order: 30 },
    ]
    expect(findCommandByKeys(cmds, { key: 'r' })?.id).toBe('r-canvas')
  })
})

