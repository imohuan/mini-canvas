/**
 * textViewMode —— 文本节点「预览 / 骨架横条（两档）/ 编辑」的判定契约。
 *
 * 用户要求（原话）：
 * - 默认显示文本，超出就裁掉（预览态）；
 * - **双击**才进入编辑态，编辑态要**给滚动条**（内容长了能滚）；
 * - 编辑态要**拦下滚轮**，别让滚轮跑去缩放画布；
 * - 「当鼠标缩放到一定程度下……我希望你可以改变成图片中的这种形式，使用不同长度的矩形色块」
 *   → 缩略态改成骨架横条；追问「两档都改吗」→「两档都改成横条」。
 *
 * 所以这里锁三件事：状态怎么判、每种状态下能不能滚、要不要拦滚轮。
 * 期望值全部来自上面这条需求（字面写死），不是照着实现反推出来的。
 */
import { describe, it, expect } from 'vitest'
import { isSkeletonMode, resolveLodThresholds, resolveTextContentSpec } from '../textViewMode'

/** 默认阈值：fullZoom=max(titleScaleMinZoom,0.2)=0.5、iconZoom=max(textLodIconZoom,0.05)=0.18 */
const base = { editing: false, zoom: 1, fullZoom: 0.5, iconZoom: 0.18 }

describe('文本节点内容状态', () => {
  it('常态缩放 → 预览：只显示内容，超出裁掉，不滚也不拦滚轮', () => {
    const spec = resolveTextContentSpec(base)
    expect(spec.mode).toBe('preview')
    expect(spec.scrollable).toBe(false)
    expect(spec.blockCanvasWheel).toBe(false)
  })

  it('编辑态 → 给滚动条，并且把滚轮拦下来（不去缩放画布）', () => {
    const spec = resolveTextContentSpec({ ...base, editing: true })
    expect(spec.mode).toBe('editing')
    expect(spec.scrollable).toBe(true)
    expect(spec.blockCanvasWheel).toBe(true)
  })

  it('编辑态优先于缩放分级：缩到只能看骨架横条时进来编辑，仍然是可滚动的编辑态', () => {
    const spec = resolveTextContentSpec({ ...base, editing: true, zoom: 0.3 })
    expect(spec.mode).toBe('editing')
    expect(spec.scrollable).toBe(true)
  })
})

describe('缩放分级（LOD）：缩略两档都是骨架横条', () => {
  it('缩到中等 → skeleton（骨架横条），仍是只读、不滚', () => {
    const spec = resolveTextContentSpec({ ...base, zoom: 0.3 })
    expect(spec.mode).toBe('skeleton')
    expect(spec.scrollable).toBe(false)
    expect(isSkeletonMode(spec.mode)).toBe(true)
  })

  it('缩到极小 → skeleton-mini（更薄更密那档横条），不是灰底占位', () => {
    const spec = resolveTextContentSpec({ ...base, zoom: 0.1 })
    expect(spec.mode).toBe('skeleton-mini')
    expect(isSkeletonMode(spec.mode)).toBe(true)
  })

  it('正好等于阈值：full 阈值算预览，icon 阈值算中等档横条（与 v1 的边界一致）', () => {
    expect(resolveTextContentSpec({ ...base, zoom: 0.5 }).mode).toBe('preview')
    expect(resolveTextContentSpec({ ...base, zoom: 0.18 }).mode).toBe('skeleton')
  })

  it('缩放值非法（NaN）→ 按常态处理，不产生坏状态', () => {
    expect(resolveTextContentSpec({ ...base, zoom: Number.NaN }).mode).toBe('preview')
  })

  it('isSkeletonMode 只认两档横条（预览与编辑都不算）', () => {
    expect(isSkeletonMode('preview')).toBe(false)
    expect(isSkeletonMode('editing')).toBe(false)
    expect(isSkeletonMode('skeleton')).toBe(true)
    expect(isSkeletonMode('skeleton-mini')).toBe(true)
  })
})

describe('resolveLodThresholds：两个可配阈值怎么收敛成分级边界', () => {
  it('读到配置值就用配置值（与 v1 一致：full 有 0.2 下限、icon 有 0.05 下限）', () => {
    expect(resolveLodThresholds(0.6, 0.25)).toEqual({ fullZoom: 0.6, iconZoom: 0.25 })
  })

  it('配置被调得过小 → 抬到下限，保证两档不会压成同一档', () => {
    expect(resolveLodThresholds(0.05, 0.01)).toEqual({ fullZoom: 0.2, iconZoom: 0.05 })
  })

  it('读不到配置（极简宿主/单测桩）→ 回落默认 0.5 / 0.18', () => {
    expect(resolveLodThresholds(undefined, undefined)).toEqual({ fullZoom: 0.5, iconZoom: 0.18 })
  })

  it('配置被改坏（字符串/NaN）→ 该项回落默认而不是让分级失效', () => {
    expect(resolveLodThresholds('0.9', Number.NaN)).toEqual({ fullZoom: 0.5, iconZoom: 0.18 })
  })
})

