import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Popover from './Popover.vue'

describe('Popover 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('toggle 后显示带标题的面板', async () => {
    const wrapper = mount(Popover, {
      props: { title: '确认信息', description: '内容说明' },
      slots: { trigger: '<button data-trigger>打开</button>' },
    })
    await wrapper.find('[data-trigger]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const panel = document.querySelector('.mck-popover__panel')
    if (!panel) throw new Error('popover panel missing')
    expect(panel.textContent).toContain('确认信息')
    expect(panel.textContent).toContain('内容说明')
  })

  it('点击关闭按钮发出 false', async () => {
    const wrapper = mount(Popover, {
      props: { title: '面板' },
      slots: { trigger: '<button data-trigger>打开</button>' },
    })
    await wrapper.find('[data-trigger]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    ;(document.querySelector('.mck-popover__close') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})
