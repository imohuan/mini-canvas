import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessagesHost from './MessagesHost.vue'
import { clearMessages, message, messageList, removeMessage } from './store'

describe('Messages 消息', () => {
  afterEach(() => {
    clearMessages()
    document.body.innerHTML = ''
  })

  it('message 入列并可移除', async () => {
    mount(MessagesHost)
    const id = message('已复制')
    await Promise.resolve()
    expect(messageList.length).toBe(1)
    removeMessage(id)
    await Promise.resolve()
    expect(messageList.length).toBe(0)
  })
})
