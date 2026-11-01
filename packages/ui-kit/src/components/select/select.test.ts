import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { markRaw } from 'vue'
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

  it('选项图标既支持 SVG 字符串，也支持 Vue 组件', async () => {
    const Icon = markRaw({ template: '<i data-component-icon />' })
    const wrapper = mount(Select, {
      props: {
        options: [
          { label: '插图', value: 'a', icon: '<svg data-svg-icon></svg>' },
          { label: '组件', value: 'b', icon: Icon },
        ],
      },
    })
    await wrapper.find('.mck-select').trigger('click')
    await wrapper.vm.$nextTick()
    const panel = document.querySelector('.mck-dropdown__panel')
    if (!panel) throw new Error('dropdown panel missing')
    expect(panel.querySelector('svg[data-svg-icon]')).not.toBeNull()
    expect(panel.querySelector('[data-component-icon]')).not.toBeNull()
    // 不能把 SVG 源码当文字渲染出来。
    expect(panel.textContent).not.toContain('<svg')
    wrapper.unmount()
  })

  it('浮层宽度、最大宽高与 inputId', async () => {
    // 独立挂载点：避免上一个用例遗留的 Teleport 目标在卸载后仍被复用。
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wrapper = mount(Select, {
      props: {
        modelValue: 'a',
        options: [{ label: 'A', value: 'a' }],
        inputId: 'theme-select',
        menuMinWidth: '260px',
        menuMaxWidth: '300px',
        menuMaxHeight: '180px',
      },
      attachTo: host,
    })
    expect(wrapper.find('.mck-select').attributes('id')).toBe('theme-select')
    await wrapper.find('.mck-select').trigger('click')
    await wrapper.vm.$nextTick()
    const panel = document.querySelector<HTMLElement>('.mck-dropdown__panel')
    // 浮动宽度按最小宽度交给 Dropdown，内容仍可继续撑开。
    expect(panel?.style.minWidth).toBe('260px')
    expect(panel?.style.width).toBe('')
    expect(panel?.style.maxWidth).toBe('300px')
    expect(panel?.style.maxHeight).toBe('180px')
    wrapper.unmount()
    host.remove()
  })

  it('分组起始行按过滤后的全局位置判定（第二组也能画分隔线）', async () => {
    const wrapper = mount(Select, {
      props: {
        options: [
          { label: 'A1', value: 'a1', group: 'A' },
          { label: 'A2', value: 'a2', group: 'A' },
          { label: 'B1', value: 'b1', group: 'B' },
        ],
      },
    })
    await wrapper.find('.mck-select').trigger('click')
    await wrapper.vm.$nextTick()
    const panel = document.querySelector('.mck-dropdown__panel')
    if (!panel) throw new Error('dropdown panel missing')
    const starts = panel.querySelectorAll('.mck-select__option.is-group-start')
    expect(starts.length).toBe(1)
    expect(starts[0]?.textContent).toContain('B1')
    wrapper.unmount()
  })
})
