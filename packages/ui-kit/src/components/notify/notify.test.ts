import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import NotifyHost from './NotifyHost.vue'
import { clear, dismiss, notify, notifyList } from './store'

/** 已挂载的宿主：测试结束要卸载，否则 sonner 的延迟动画会在环境拆除后才跑。 */
const mounted: Array<ReturnType<typeof mount>> = []

function mountHost(): ReturnType<typeof mount> {
  const wrapper = mount(NotifyHost, { attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

describe('Notify 通知', () => {
  afterEach(async () => {
    clear()
    // sonner 用 requestAnimationFrame 派发 dismiss；先让它落地再拆环境，
    // 否则回调在 happy-dom 拆除后执行，会报 requestAnimationFrame is not defined。
    await new Promise((resolve) => setTimeout(resolve, 32))
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('notify 入列并可手动关闭', async () => {
    mountHost()
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
    mountHost()
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
