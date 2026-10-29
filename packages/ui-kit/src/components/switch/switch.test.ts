import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Switch from './Switch.vue'

describe('Switch 组件行为', () => {
  it('点击切换并派发 update:modelValue / change', async () => {
    const wrapper = mount(Switch, { props: { modelValue: false, label: '自动保存' } })
    await wrapper.find('input').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
    expect(wrapper.emitted('change')?.[0]).toEqual([true])
  })

  it('loading 与 disabled 都不能切换', async () => {
    const loading = mount(Switch, { props: { modelValue: false, loading: true, label: 'x' } })
    await loading.find('input').setValue(true)
    expect(loading.emitted('update:modelValue')).toBeUndefined()
    const disabled = mount(Switch, { props: { modelValue: false, disabled: true, label: 'x' } })
    await disabled.find('input').setValue(true)
    expect(disabled.emitted('update:modelValue')).toBeUndefined()
  })
})
