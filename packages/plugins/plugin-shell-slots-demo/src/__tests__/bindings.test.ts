/**
 * bindings —— 上下文取件层的单测（Node 直跑，不碰 DOM）。
 *
 * 锁三件事：
 * 1. 主题按钮来自 ui 注册场，换主题（同名字段替换）后跟着变；
 * 2. 节点数来自 doc 服务，doc 变化时刷新；
 * 3. 打开抽屉走 command 执行，不依赖 window / 具体 UI 包。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { createBindings } from '../bindings'

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
    const b = createBindings({ ui })

    expect(b.button.value).toBe(ButtonA)

    ui.add('button', ButtonB, { id: 'other', order: -1 })
    expect(b.button.value).toBe(ButtonB)

    b.dispose()
  })

  it('dispose 后 ui 再变也不再更新（订阅随插件作用域摘除）', () => {
    const ui = makeUi()
    const b = createBindings({ ui })
    b.dispose()

    ui.add('button', ButtonB, { id: 'other', order: -1 })
    expect(b.button.value).toBe(ButtonA)
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

    const b = createBindings({ ui: makeUi(), doc })
    expect(b.nodeCount.value).toBe(2)

    nodes = [1, 2, 3]
    for (const fn of listeners) fn()
    expect(b.nodeCount.value).toBe(3)

    b.dispose()
    expect(listeners.size).toBe(0)
  })

  it('没有 doc 时节点数保持 0（极简宿主也能装）', () => {
    const b = createBindings({ ui: makeUi() })
    expect(b.nodeCount.value).toBe(0)
    b.dispose()
  })

  it('打开抽屉经 command 执行 shell:open-drawer', () => {
    const execute = vi.fn()
    const b = createBindings({ ui: makeUi(), command: { execute } })

    b.openDrawer()
    expect(execute).toHaveBeenCalledWith('shell:open-drawer')

    b.dispose()
  })

  it('没有 command 时点击是 no-op（不抛错）', () => {
    const b = createBindings({ ui: makeUi() })
    expect(() => b.openDrawer()).not.toThrow()
    b.dispose()
  })
})
