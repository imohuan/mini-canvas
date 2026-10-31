import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import NotifyHost from './NotifyHost.vue'
import { clear, dismiss, notify, notifyList } from './store'

describe('Notify 通知', () => {
  afterEach(() => {
    clear()
    document.body.innerHTML = ''
  })

  it('notify 入列并可手动关闭', async () => {
    const wrapper = mount(NotifyHost, { attachTo: document.body })
    const id = notify({ title: '已保存', tone: 'success' })
    await flushPromises()
    await nextTick()
    expect(notifyList.length).toBe(1)
    expect(document.querySelector('.mck-notify')).not.toBeNull()
    dismiss(id)
    await flushPromises()
    expect(notifyList.length).toBe(0)
  })

  it('action 点击后回调并清除', async () => {
    const wrapper = mount(NotifyHost, { attachTo: document.body })
    let clicked = 0
    notify({ title: '新版本', duration: 0, action: { label: '查看', onClick: () => { clicked += 1 } } })
    await flushPromises()
    await nextTick()
    ;(document.querySelector('.mck-notify__action') as HTMLButtonElement).click()
    expect(clicked).toBe(1)
    await flushPromises()
    expect(notifyList.length).toBe(0)
  })
})
