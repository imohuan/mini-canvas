import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * TabsList 的滑动胶囊契约（用户口径 2026-11-04：「把切换变成动画效果（胶囊）」）。
 *
 * 钉住三件事，防止以后有人把它当成「某个页面的临时美化」删掉或改回静态底色：
 *   1. 选中底是一条单独的 absolute 元素，用 transform / width 过渡滑过去；
 *   2. 选中项自己不再画底（否则两层底叠在一起）；
 *   3. 尊重 prefers-reduced-motion，并允许调用方用 :animated="false" 关掉。
 */
const source = readFileSync(
  new URL('../components/ui/tabs/TabsList.vue', import.meta.url),
  'utf-8',
)

describe('TabsList 滑动胶囊', () => {
  it('胶囊是列表里的绝对定位层，靠 transform 过渡', () => {
    expect(source, '缺少胶囊元素').toMatch(/cn-tabs-capsule/)
    expect(source, '胶囊没有按 transform 定位').toMatch(/transform:\s*['"]translateX/)
    expect(source, '胶囊缺少 transition（不会滑动）').toMatch(/transition:[\s\S]{0,160}transform/)
  })

  it('位置按真实矩形量，不用百分比猜', () => {
    expect(source, '没有按选中项矩形算左偏移').toMatch(/getBoundingClientRect\(\)[\s\S]{0,200}capsuleLeft/)
    expect(source, '没有监听尺寸变化（字号档/文案变了会错位）').toMatch(/ResizeObserver/)
  })

  it('选中项让位：不再自己画底', () => {
    expect(source, '选中态仍画底，会和胶囊叠成两层').toMatch(
      /tabs-trigger'\]\[data-state='active'\]\)\s*\{\s*background:\s*transparent/,
    )
  })

  it('可关闭，且尊重减少动效', () => {
    expect(source, '没有提供关闭开关').toMatch(/animated/)
    expect(source, '没处理 prefers-reduced-motion').toMatch(/prefers-reduced-motion/)
  })
})
