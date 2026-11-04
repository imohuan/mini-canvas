import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TabsList 的滑动胶囊契约（用户口径 2026-11-04：「把切换变成动画效果（胶囊）」）。
 *
 * 钉住这些事，防止以后有人把它当成「某个页面的临时美化」删掉、改回静态底色，
 * 或者重新踩回这次实测出来的坑。
 */
const source = readFileSync(
  new URL('../components/ui/tabs/TabsList.vue', import.meta.url),
  'utf-8',
)

describe('TabsList 滑动胶囊', () => {
  it('胶囊是列表里的绝对定位层，靠 transform 过渡', () => {
    expect(source, '缺少胶囊元素').toMatch(/cn-tabs-capsule/)
    expect(source, '胶囊没有按 transform 定位').toMatch(/transform:\s*['"]translate\(/)
    expect(source, '胶囊缺少 transition（不会滑动）').toMatch(/transition:[\s\S]{0,160}transform/)
  })

  it('位置/尺寸按真实矩形量，不用百分比猜', () => {
    expect(source, '没有按选中项矩形算左偏移与宽高').toMatch(/getBoundingClientRect\(\)[\s\S]{0,600}capsuleWidth/)
    expect(source, '没有监听尺寸变化（字号档/文案变了会错位）').toMatch(/ResizeObserver/)
  })

  it('换选中项时不靠 ResizeObserver 猜（尺寸不变它不触发），点击后重量', () => {
    expect(source, '点击换页签后没有重量，胶囊会停在旧位置').toMatch(/onListClick/)
    expect(source, '重量没有等 DOM 落定').toMatch(/nextTick\(\(\) => \{\s*measure\(\)/)
  })

  it('列表 ref 必须取到 DOM 元素（reka 的 TabsList 是组件，直接 observe 会抛）', () => {
    expect(source, '没有从组件实例上取 $el').toMatch(/\$el/)
    expect(source, 'observe 前没有过滤非元素节点').toMatch(/instanceof Element/)
  })

  it('选中项让位：不再自己画底', () => {
    expect(source, '选中态仍画底，会和胶囊叠成两层').toMatch(
      /tabs-trigger'\]\[data-state='active'\]\)\s*\{\s*background:\s*transparent/,
    )
  })

  it('胶囊颜色走宿主 token，不能用 --background（暗色下会变成死白色块）', () => {
    expect(source, '胶囊没有用 --ui-tab-capsule / --ui-panel-active 这类宿主 token').toMatch(
      /var\(--ui-tab-capsule,\s*var\(--ui-panel-active/,
    )
    expect(source, '胶囊又退回 --background 了（暗色变白色块）').not.toMatch(
      /cn-tabs-capsule[\s\S]{0,400}background:\s*var\(--background/,
    )
  })

  it('可关闭，且尊重减少动效', () => {
    expect(source, '没有提供关闭开关').toMatch(/animated/)
    expect(source, '没处理 prefers-reduced-motion').toMatch(/prefers-reduced-motion/)
  })
})
