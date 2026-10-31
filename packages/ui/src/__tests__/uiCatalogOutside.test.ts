/**
 * 「画布树外取 UI 组件」的时序：组件先挂载、宿主后 ready 也必须能拿到并跟着换。
 *
 * 对应真实 bug：只在 onMounted 查一次目录 → 宿主晚到 → 永远显示 fallback。
 */
import { describe, expect, it } from 'vitest'
import { createOutsideComponentTracker, type UiCatalogFieldLike } from '../composables/uiCatalogOutside'

function makeField(initial: string) {
  let value = initial
  const listeners = new Set<() => void>()
  const field: UiCatalogFieldLike<string> = {
    top: () => ({ value }),
    subscribe(fn) {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },
  }
  return {
    field,
    set(next: string) {
      value = next
      for (const fn of listeners) fn()
    },
    listeners,
  }
}

describe('画布树外取件订阅器', () => {
  it('先建订阅器、后 ready：bind 后立即拿到目录赢家', () => {
    let field: UiCatalogFieldLike<string> | undefined
    const tracker = createOutsideComponentTracker('button', () => field)
    expect(tracker.current.value).toBeUndefined()

    const fake = makeField('主按钮')
    field = fake.field
    tracker.bind()
    expect(tracker.current.value).toBe('主按钮')
  })

  it('bind 之后目录换赢家会自动更新；重复 bind 不会留旧订阅', () => {
    const first = makeField('A')
    let field: UiCatalogFieldLike<string> | undefined = first.field
    const tracker = createOutsideComponentTracker('button', () => field)
    tracker.bind()
    expect(first.listeners.size).toBe(1)

    first.set('B')
    expect(tracker.current.value).toBe('B')

    // 宿主重连：旧订阅必须解掉，否则旧目录的更新会继续改写界面。
    const second = makeField('C')
    field = second.field
    tracker.bind()
    expect(first.listeners.size).toBe(0)
    expect(tracker.current.value).toBe('C')
    second.set('D')
    expect(tracker.current.value).toBe('D')
  })

  it('宿主销毁：回到 fallback，且不再响应旧目录', () => {
    const fake = makeField('A')
    let field: UiCatalogFieldLike<string> | undefined = fake.field
    const tracker = createOutsideComponentTracker('button', () => field)
    tracker.bind()
    expect(tracker.current.value).toBe('A')

    field = undefined
    tracker.bind()
    expect(tracker.current.value).toBeUndefined()
    fake.set('B')
    expect(tracker.current.value).toBeUndefined()
  })
})
