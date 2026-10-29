import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Tooltip from './Tooltip.vue'

describe('Tooltip 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hover 延迟后显示内容', async () => {
    const wrapper = mount(Tooltip, {
      props: { content: '提示文字', delay: 10 },
      slots: { default: '<button>触发</button>' },
    })
    await wrapper.find('.mck-tooltip-trigger').trigger('mouseenter')
    await new Promise((resolve) => setTimeout(resolve, 60))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.mck-tooltip')?.textContent).toContain('提示文字')
  })

  it('disabled 时不显示', async () => {
    const wrapper = mount(Tooltip, {
      props: { content: '提示文字', delay: 0, disabled: true },
      slots: { default: '<button>触发</button>' },
    })
    await wrapper.find('.mck-tooltip-trigger').trigger('mouseenter')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.mck-tooltip')).toBeNull()
  })
})
