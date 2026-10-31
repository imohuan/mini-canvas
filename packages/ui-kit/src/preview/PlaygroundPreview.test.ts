import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PlaygroundPreview from './PlaygroundPreview.vue'

function mountButton(state: Record<string, unknown>) {
  return mount(PlaygroundPreview, {
    props: {
      id: 'button',
      state: {
        label: '开始创作',
        variant: 'primary',
        size: 'md',
        showIcon: true,
        iconOnly: false,
        block: false,
        round: false,
        disabled: false,
        loading: false,
        ...state,
      },
    },
  })
}

describe('Button 试玩预览', () => {
  it('清空按钮文字后自动变成纯图标按钮，不留空白文字区', () => {
    const wrapper = mountButton({ label: '' })
    const button = wrapper.find('button')
    expect(button.classes()).toContain('is-icon-only')
    expect(button.find('.mck-button__label').exists()).toBe(false)
  })

  it('打开「只显示图标」时，按钮进入纯图标形态', () => {
    const wrapper = mountButton({ iconOnly: true })
    expect(wrapper.find('button').classes()).toContain('is-icon-only')
  })
})
