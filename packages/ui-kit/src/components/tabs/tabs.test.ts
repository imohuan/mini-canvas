import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Tabs from './Tabs.vue'

const items = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B', disabled: true },
  { value: 'c', label: 'C' },
]

describe('Tabs 组件行为', () => {
  it('点击可用项并高亮，禁用项不可点', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'a', items } })
    const buttons = wrapper.findAll('[role="tab"]')
    await buttons[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['c'])
    await buttons[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('方向键跳过禁用项并循环', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'a', items } })
    const buttons = wrapper.findAll('[role="tab"]')
    await buttons[0].trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['c'])
  })
})
