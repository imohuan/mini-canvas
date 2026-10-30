/**
 * 媒体预览关闭时必须**恢复**原滚动状态，而不是无脑清空（2026-10-30 扫描发现）。
 *
 * 预常常叠在别的弹窗上（资产 / 历史 / 对话框），那些弹窗正锁着滚动
 * （body.overflow = hidden）。旧实现关闭时写 `body.style.overflow = ''`，
 * 等于把底下的弹窗也一起解锁 —— 用户能在弹窗背后滚动画布。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../MediaViewer.vue', import.meta.url), 'utf-8')

describe('MediaViewer 滚动锁', () => {
  it('不再无脑清空 body.overflow，而是记原值再恢复', () => {
    expect(src, '仍在把 body.overflow 直接清空').not.toMatch(/document\.body\.style\.overflow\s*=\s*["']{2}/)
    expect(src, '没有记原值').toMatch(/overflowBeforeOpen/)
    expect(src, '没有恢复函数').toMatch(/restoreBodyOverflow/)
  })
})
