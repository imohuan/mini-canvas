import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SplitPane from './SplitPane.vue'

describe('SplitPane 组件行为', () => {
  it('render 两个面板与中间分隔条', () => {
    const wrapper = mount(SplitPane, {
      slots: { left: '<div data-left>左边</div>', right: '<div data-right>右边</div>' },
    })
    expect(wrapper.find('[data-left]').exists()).toBe(true)
    expect(wrapper.find('[data-right]').exists()).toBe(true)
    expect(wrapper.find('.mck-split__divider').exists()).toBe(true)
    expect(wrapper.find('.mck-split__divider').attributes('role')).toBe('separator')
  })

  it('分隔条只有细线和小胶囊，不带图标或边框', () => {
    const wrapper = mount(SplitPane)
    const divider = wrapper.find('.mck-split__divider')
    expect(divider.find('.mck-split__line').exists()).toBe(true)
    expect(divider.find('.mck-split__grip').exists()).toBe(true)
    // 参考实现是纯胶囊，没有 svg 图标
    expect(divider.find('svg').exists()).toBe(false)
  })

  it('direction=vertical 时切换成上下布局', () => {
    const wrapper = mount(SplitPane, { props: { direction: 'vertical' } })
    expect(wrapper.find('.mck-split').classes()).toContain('is-vertical')
    expect(wrapper.find('.mck-split__divider').attributes('aria-orientation')).toBe('horizontal')
  })
})
