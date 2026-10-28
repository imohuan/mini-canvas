/**
 * bindings —— 从 ctx 取数据的纯逻辑单测（Node 直跑，不碰 DOM）。
 *
 * 组件侧再包一层 useThemedButton / useNodeCount / useOpenDrawer（useShellDemo.ts）。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { openDrawer, readNodeCount, readThemedButton } from '../bindings'

const ButtonA = { name: 'ButtonA' }
const ButtonB = { name: 'ButtonB' }

function makeUi(): ReturnType<Context['registryOf']> {
  const ui = new Context().registryOf('button-test')
  ui.add('button', ButtonA, { id: 'default' })
  return ui
}

describe('plugin-shell-slots-demo · bindings', () => {
  it('主题按钮从 ui 注册场取，换主题后当场跟着换', () => {
    const ui = makeUi()
    const b = readThemedButton(ui)

    expect(b.button.value).toBe(ButtonA)

    ui.add('button', ButtonB, { id: 'other', order: -1 })
    expect(b.button.value).toBe(ButtonB)

    b.dispose()
  })

  it('dispose 后 ui 再变也不再更新（订阅随组件卸载摘除）', () => {
    const ui = makeUi()
    const b = readThemedButton(ui)
    b.dispose()

    ui.add('button', ButtonB, { id: 'other', order: -1 })
    expect(b.button.value).toBe(ButtonA)
  })

  it('没有 ui 场时按钮为 undefined（极简宿主也能装）', () => {
    const b = readThemedButton()
    expect(b.button.value).toBeUndefined()
    b.dispose()
  })

  it('节点数来自 doc 服务并随 doc 变化刷新', () => {
    const listeners = new Set<() => void>()
    let nodes: unknown[] = [1, 2]
    const doc = {
      getNodes: () => nodes,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }

    const b = readNodeCount(doc)
    expect(b.count.value).toBe(2)

    nodes = [1, 2, 3]
    for (const fn of listeners) fn()
    expect(b.count.value).toBe(3)

    b.dispose()
    expect(listeners.size).toBe(0)
  })

  it('没有 doc 时节点数保持 0', () => {
    const b = readNodeCount()
    expect(b.count.value).toBe(0)
    b.dispose()
  })

  it('打开抽屉经 command 执行 shell:open-drawer；没有 command 时 no-op', () => {
    const execute = vi.fn()
    openDrawer({ execute })
    expect(execute).toHaveBeenCalledWith('shell:open-drawer')

    expect(() => openDrawer()).not.toThrow()
  })
})
