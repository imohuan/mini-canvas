import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NumberInput from './NumberInput.vue'

describe('NumberInput 组件行为', () => {
  it('越界输入在失焦时夹到范围内', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 0, min: 0, max: 10 } })
    const input = wrapper.find('input')
    input.element.value = '99'
    await input.trigger('blur')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([10])
  })

  it('步进按钮按 step 增减并夹住范围', async () => {
    const wrapper = mount(NumberInput, { props: { modelValue: 9, min: 0, max: 10, step: 2 } })
    await wrapper.find('[aria-label="增加"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([10])
    await wrapper.find('[aria-label="增加"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([10])
  })
})
