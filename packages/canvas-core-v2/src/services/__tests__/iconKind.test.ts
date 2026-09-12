import { describe, it, expect } from 'vitest'
import { iconRenderMode } from '../iconKind'

describe('iconRenderMode（图标句柄形态判定）', () => {
  it('字符串图标判为 html（v-html 渲染）', () => {
    expect(iconRenderMode('<svg viewBox="0 0 24 24"></svg>')).toBe('html')
  })

  it('Vue 组件图标判为 component（<component :is> 渲染）', () => {
    const Comp = { name: 'FakeIcon', render: () => null }
    expect(iconRenderMode(Comp)).toBe('component')
  })

  it('未声明（undefined/null/false/空串）判为 none', () => {
    expect(iconRenderMode(undefined)).toBe('none')
    expect(iconRenderMode(null)).toBe('none')
    expect(iconRenderMode(false)).toBe('none')
    expect(iconRenderMode('')).toBe('none')
  })
})
