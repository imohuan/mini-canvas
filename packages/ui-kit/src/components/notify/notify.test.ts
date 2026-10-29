import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NotifyHost from './NotifyHost.vue'
import { clear, dismiss, notify, notifyList } from './store'

describe('Notify 通知', () => {
  afterEach(() => {
    clear()
    document.body.innerHTML = ''
  })

  it('notify 入列并可手动关闭', async () => {
    mount(NotifyHost)
    const id = notify({ title: '已保存', tone: 'success' })
    await Promise.resolve()
    expect(notifyList.length).toBe(1)
    dismiss(id)
    await Promise.resolve()
    expect(notifyList.length).toBe(0)
  })

  it('action 点击后回调并清除', async () => {
    mount(NotifyHost)
    let clicked = 0
    notify({ title: '新版本', duration: 0, action: { label: '查看', onClick: () => { clicked += 1 } } })
    await Promise.resolve()
    ;(document.querySelector('.mck-notify__action') as HTMLButtonElement).click()
    expect(clicked).toBe(1)
    await Promise.resolve()
    expect(notifyList.length).toBe(0)
  })
})
