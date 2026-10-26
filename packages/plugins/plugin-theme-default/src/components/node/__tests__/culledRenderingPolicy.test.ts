import { describe, expect, it } from 'vitest'
import { CULLED_RENDERING_DEFAULT, culledPolicy, normalizeCulledRendering } from '../culledRenderingPolicy'

describe('culledRenderingPolicy（视口外节点绘制策略）', () => {
  it('visible 状态恒全量（任何档位都不降级）', () => {
    for (const rendering of ['skeleton', 'full', 'ghost'] as const) {
      expect(culledPolicy('visible', rendering)).toEqual({ reduced: false, visibleCard: true, ghost: false })
    }
  })

  it('skeleton 档：culled / culled-linked 降级 + 卡片隐身', () => {
    expect(culledPolicy('culled', 'skeleton')).toEqual({ reduced: true, visibleCard: false, ghost: false })
    expect(culledPolicy('culled-linked', 'skeleton')).toEqual({ reduced: true, visibleCard: false, ghost: false })
  })

  it('ghost 档：降级 + 可见空心框', () => {
    expect(culledPolicy('culled', 'ghost')).toEqual({ reduced: true, visibleCard: true, ghost: true })
    expect(culledPolicy('culled-linked', 'ghost')).toEqual({ reduced: true, visibleCard: true, ghost: true })
  })

  it('full 档：culled 也不降级（等同关闭降级）', () => {
    expect(culledPolicy('culled', 'full')).toEqual({ reduced: false, visibleCard: true, ghost: false })
    expect(culledPolicy('culled-linked', 'full')).toEqual({ reduced: false, visibleCard: true, ghost: false })
  })

  it('三档切换：skeleton → full → ghost → skeleton 每步行为正确翻转（设置面板实时生效的语义）', () => {
    const walk = (rendering: typeof CULLED_RENDERING_DEFAULT) => culledPolicy('culled', rendering)
    expect(walk('skeleton').reduced).toBe(true)
    expect(walk('full').reduced).toBe(false)
    expect(walk('ghost').reduced).toBe(true)
    expect(walk('ghost').ghost).toBe(true)
    expect(walk('skeleton').ghost).toBe(false)
  })

  it('transient/undefined（壳未收到状态）恒全量', () => {
    expect(culledPolicy(undefined, 'skeleton').reduced).toBe(false)
    expect(culledPolicy('transient', 'skeleton').reduced).toBe(false)
  })

  it('normalizeCulledRendering：非法值回落 skeleton，合法值原样', () => {
    expect(normalizeCulledRendering(undefined)).toBe('skeleton')
    expect(normalizeCulledRendering('weird')).toBe('skeleton')
    expect(normalizeCulledRendering('ghost')).toBe('ghost')
  })
})
