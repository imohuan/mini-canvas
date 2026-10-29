import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Confirm from './Confirm.vue'

describe('Confirm 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('确认按钮发出 confirm 并关闭', async () => {
    const wrapper = mount(Confirm, {
      props: { modelValue: true, title: '删除项目', description: '不可恢复' },
    })
    await wrapper.vm.$nextTick()
    const buttons = Array.from(document.querySelectorAll('.mck-dialog__foot button'))
    expect(buttons.length).toBe(2)
    ;(buttons[1] as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('取消按钮发出 cancel', async () => {
    const wrapper = mount(Confirm, { props: { modelValue: true } })
    await wrapper.vm.$nextTick()
    const buttons = Array.from(document.querySelectorAll('.mck-dialog__foot button'))
    ;(buttons[0] as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
