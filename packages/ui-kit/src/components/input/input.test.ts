import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Input from './Input.vue'

describe('Input 组件行为', () => {
  it('输入即时更新 v-model，错误时带 aria-invalid 与描述', async () => {
    const wrapper = mount(Input, { props: { modelValue: '', error: '不能为空' } })
    await wrapper.find('input').setValue('hi')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['hi'])
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('不能为空')
  })

  it('clearable 点击清空并派发 clear', async () => {
    const wrapper = mount(Input, { props: { modelValue: 'abc', clearable: true } })
    await wrapper.find('.mck-input__clear').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([''])
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('ariaLabel 落在真正的 input 上，而不是外层容器', () => {
    const wrapper = mount(Input, { props: { ariaLabel: '搜索画布' } })
    expect(wrapper.find('input').attributes('aria-label')).toBe('搜索画布')
    expect(wrapper.find('.mck-input').attributes('aria-label')).toBeUndefined()
  })

  it('原生 aria-label 也会转给内部 input', () => {
    const wrapper = mount(Input, { attrs: { 'aria-label': '文件名' } })
    expect(wrapper.find('input').attributes('aria-label')).toBe('文件名')
    expect(wrapper.find('.mck-input').attributes('aria-label')).toBeUndefined()
  })
})
