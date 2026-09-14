/**
 * 裁剪会话 / 加载失败共享态 —— 两组跨组件状态的行为契约。
 *
 * 为什么值得测：这两处**刻意不写进节点 data**（写进去就会落盘，刷新后"裁剪中"复活、
 * "图片已失效"误报，还会占据撤销栈）。测试锁住的是"按节点隔离 + 可开可关"，
 * 也顺带证明它与内核数据无关（纯会话态）。
 */
import { describe, it, expect } from 'vitest'
import { beginCrop, croppingIds, endCrop, isCropping } from '../cropSession'
import { brokenIds, clearImageBroken, isImageBroken, markImageBroken } from '../imageStatus'

describe('cropSession：裁剪会话', () => {
  it('默认不在裁剪；begin 后可查', () => {
    expect(isCropping('n1')).toBe(false)
    beginCrop('n1')
    expect(isCropping('n1')).toBe(true)
    endCrop('n1')
    expect(isCropping('n1')).toBe(false)
  })

  it('按节点隔离：一个节点裁剪不影响另一个', () => {
    beginCrop('a')
    expect(isCropping('a')).toBe(true)
    expect(isCropping('b')).toBe(false)
    endCrop('a')
  })

  it('重复 begin / 重复 end 都幂等，不会残留', () => {
    beginCrop('x')
    beginCrop('x')
    expect(croppingIds().filter((id) => id === 'x')).toHaveLength(1)
    endCrop('x')
    endCrop('x')
    expect(isCropping('x')).toBe(false)
  })

  it('空 id 不写入（防幽灵条目）', () => {
    beginCrop('')
    expect(croppingIds()).not.toContain('')
  })
})

describe('imageStatus：加载失败共享态', () => {
  it('默认视为未失效', () => {
    expect(isImageBroken('fresh')).toBe(false)
  })

  it('标记后可查，清除后复位', () => {
    markImageBroken('n2')
    expect(isImageBroken('n2')).toBe(true)
    clearImageBroken('n2')
    expect(isImageBroken('n2')).toBe(false)
  })

  it('按节点隔离', () => {
    markImageBroken('p')
    expect(isImageBroken('p')).toBe(true)
    expect(isImageBroken('q')).toBe(false)
    clearImageBroken('p')
  })

  it('空 id 不写入；清除不存在的 id 不抛', () => {
    markImageBroken('')
    expect(brokenIds()).not.toContain('')
    expect(() => clearImageBroken('never')).not.toThrow()
  })
})
