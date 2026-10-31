import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import PlaygroundPreview from './PlaygroundPreview.vue'

const source = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

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

  it('预览图标在 24 的画布里居中，不改按钮盒子的对齐', () => {
    const wrapper = mountButton({ iconOnly: true })
    const d = wrapper.find('svg path').attributes('d')
    const points = (d ?? '')
      .match(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)
      ?.map((pair) => pair.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [])
      ?? []
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)

    expect(Math.min(...xs) + Math.max(...xs)).toBe(24)
    expect(Math.min(...ys) + Math.max(...ys)).toBe(24)
  })
})

describe('通知类组件的宿主', () => {
  it('预览页只挂一次 NotifyHost 与 MessagesHost', () => {
    // UiKitPreview 依赖构建期的虚拟文档模块，单测里挂不起来，改为检查模板源码。
    const preview = source('./UiKitPreview.vue')
    expect(preview.match(/<NotifyHost\s*\/>/g) ?? []).toHaveLength(1)
    expect(preview.match(/<MessagesHost\s*\/>/g) ?? []).toHaveLength(1)
  })

  it('组件的试玩分支不再自己挂宿主', () => {
    const wrapper = mount(PlaygroundPreview, { props: { id: 'notify', state: {} } })
    expect(wrapper.findComponent({ name: 'MckNotifyHost' }).exists()).toBe(false)
    expect(source('./PlaygroundPreview.vue')).not.toMatch(/<MessagesHost\s*\/>/)
  })
})
