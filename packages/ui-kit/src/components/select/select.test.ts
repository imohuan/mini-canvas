import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Select from './Select.vue'

describe('Select 组件行为', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('打开后点击选项更新选中值', async () => {
    const wrapper = mount(Select, {
      props: {
        options: [
          { label: '北京', value: 'bj' },
          { label: '上海', value: 'sh' },
        ],
      },
    })
    await wrapper.find('.mck-select').trigger('click')
    await wrapper.vm.$nextTick()
    const panel = document.querySelector('.mck-dropdown__panel')
    if (!panel) throw new Error('dropdown panel missing')
    const options = panel.querySelectorAll('.mck-select__option')
    expect(options.length).toBe(2)
    ;(options[1] as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['sh'])
  })

  it('clearable 时点清空按钮发出 null', async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: 'bj',
        clearable: true,
        options: [
          { label: '北京', value: 'bj' },
          { label: '上海', value: 'sh' },
        ],
      },
    })
    await wrapper.find('.mck-select__clear').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })
})
