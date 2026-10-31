/**
 * Notify 必须真的交给 vue-sonner，而不是继续维护一套自己的队列。
 *
 * 行为契约：
 *   1. `notify()` 复用 sonner 的 toast（同一 id 更新而不是再堆一条）；
 *   2. `dismiss()` / `clear()` 照样能用；
 *   3. 卡片通过自定义组件渲染，tone / 说明 / 操作按钮由我们控制；
 *   4. `NotifyHost` 挂上 `<Toaster>`，并跟随 Provider 的层级与主题。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: sonner.toast,
  Toaster: { name: 'MockToaster', render: () => null },
}))

import { clear, dismiss, notify } from './store'
import { notifyList } from './store'

describe('Notify 交给 vue-sonner', () => {
  afterEach(() => {
    clear()
    for (const fn of Object.values(sonner.toast)) {
      if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear()
    }
  })

  it('字符串标题转成成功/信息卡，默认自动关闭', () => {
    const id = notify('已保存')
    expect(sonner.toast.custom).toHaveBeenCalledTimes(1)
    const [component, options] = sonner.toast.custom.mock.calls[0]
    expect(component).toBeTruthy()
    expect(typeof options.id).toBe('string')
    expect(options.duration).toBe(3600)
    expect(id).toBe(options.id)
  })

  it('对象不带 duration 时仍是 3.6 秒自动关闭（老行为）', () => {
    notify({ title: '已保存' })
    const [, options] = sonner.toast.custom.mock.calls[0]
    expect(options.duration).toBe(3600)
  })

  it('duration=0 表示常驻，不交给自动关闭', () => {
    notify({ title: '常驻', duration: 0 })
    const [, options] = sonner.toast.custom.mock.calls[0]
    expect(options.duration).toBe(Infinity)
  })

  it('同一个 id 再次 notify 是更新，不新增', () => {
    notify({ id: 'same', title: '第一次' })
    notify({ id: 'same', title: '第二次' })
    expect(sonner.toast.custom).toHaveBeenCalledTimes(2)
    expect(sonner.toast.custom.mock.calls[1][1].id).toBe('same')
    expect(notifyList.length).toBe(1)
  })

  it('dismiss 与 clear 同步给 sonner', () => {
    const a = notify('a')
    const b = notify('b')
    expect(notifyList.length).toBe(2)
    dismiss(a)
    expect(sonner.toast.dismiss).toHaveBeenCalledWith(a)
    expect(notifyList.length).toBe(1)
    clear()
    expect(sonner.toast.dismiss).toHaveBeenCalledWith(b)
    expect(notifyList.length).toBe(0)
  })
})
