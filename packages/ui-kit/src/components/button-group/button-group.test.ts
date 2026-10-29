import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Button from '../button/Button.vue'
import ButtonGroup from './ButtonGroup.vue'

describe('ButtonGroup 组件行为', () => {
  it('attached 分组渲染为整体', () => {
    const wrapper = mount(ButtonGroup, {
      slots: { default: Button },
    })
    const group = wrapper.find('[role="group"]')
    expect(group.classes()).toContain('is-attached')
    expect(group.findAll('button').length).toBe(1)
  })
  it('vertical 方向切换类名', () => {
    const wrapper = mount(ButtonGroup, { props: { orientation: 'vertical' }, slots: { default: Button } })
    expect(wrapper.find('.mck-button-group').classes()).toContain('is-vertical')
  })
})
