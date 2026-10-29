import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Slider from './Slider.vue'

describe('Slider 组件行为', () => {
  it('键盘方向键按 step 更新值', async () => {
    const wrapper = mount(Slider, { props: { modelValue: 40, min: 0, max: 100, step: 5 } })
    const root = wrapper.find('[role="slider"]')
    await root.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([45])
    await root.trigger('keydown', { key: 'PageUp' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([90])
  })

  it('Home/End 跳到边界并触发 change', async () => {
    const wrapper = mount(Slider, { props: { modelValue: 40, min: 0, max: 100 } })
    const root = wrapper.find('[role="slider"]')
    await root.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([100])
    expect(wrapper.emitted('change')?.at(-1)).toEqual([100])
    await root.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([0])
  })

  it('disabled 时键盘不更新', async () => {
    const wrapper = mount(Slider, { props: { modelValue: 40, disabled: true } })
    await wrapper.find('[role="slider"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
