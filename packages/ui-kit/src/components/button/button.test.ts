import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Button from './Button.vue'

describe('Button 组件行为', () => {
  it('图标按钮保持正方形：iconOnly 时宽高等于尺寸变量', () => {
    const wrapper = mount(Button, {
      props: { iconOnly: true, ariaLabel: '新增' },
      slots: { icon: '<svg data-icon="plus"></svg>' },
    })
    const button = wrapper.find('button')
    expect(button.classes()).toContain('is-icon-only')
    expect(button.attributes('aria-label')).toBe('新增')
    expect(button.find('svg[data-icon="plus"]').exists()).toBe(true)
    expect(button.text()).not.toContain('新增')
  })

  it('loading 时禁用并显示 spinner，不会触发 click', async () => {
    const wrapper = mount(Button, { props: { loading: true }, slots: { default: '保存中' } })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('普通点击只派发一次 click', async () => {
    const wrapper = mount(Button, { slots: { default: '开始' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
