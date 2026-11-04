/**
 * 「能不能加入画布」的判据：doc 与 media 两件都要在。
 *
 * 用户口径（18 号文档 §style-library）：素材库在项目页能浏览，缺画布能力时
 * 「加入」要**禁用并给出可见原因**，不能点下去才失败。这里同时钉住两种情况：
 * 缺画布 → 提示打开画布；有画布但缺 media 能力 → 提示媒体能力不可用。
 */
import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useCanvasGate, type CanvasGateCtx } from './useCanvasGate'

/** 假 ctx：服务表与能力场都可控。 */
function ctxWith(opts: { doc?: boolean; media?: boolean }): CanvasGateCtx {
  const mediaFactory = () => ({ put: () => undefined })
  return {
    tryGet<T>(name: string): T | undefined {
      return (name === 'doc' && opts.doc ? ({ id: 'doc' } as unknown as T) : undefined)
    },
    registryOf<T>(kind: string) {
      if (kind !== 'capability') return undefined
      return {
        top(key: string) {
          if (key !== 'media') return undefined
          return opts.media ? { value: mediaFactory as unknown as T } : undefined
        },
      }
    },
  }
}

describe('素材库加入画布的闸门', () => {
  it('缺画布：禁用并提示打开画布', () => {
    const scope = effectScope()
    const gate = scope.run(() => useCanvasGate(ctxWith({}), '素材'))!
    expect(gate.canUse.value).toBe(false)
    expect(gate.reason.value).toContain('打开一张画布')
    scope.stop()
  })

  it('有画布但缺 media 能力：禁用，提示媒体能力不可用（不再只说“打开画布”）', () => {
    const scope = effectScope()
    const gate = scope.run(() => useCanvasGate(ctxWith({ doc: true }), '素材'))!
    expect(gate.hasCanvas.value).toBe(true)
    expect(gate.hasMedia.value).toBe(false)
    expect(gate.canUse.value).toBe(false)
    expect(gate.reason.value).toContain('媒体能力')
    scope.stop()
  })

  it('画布与 media 都在：可以加入，且没有禁用原因', () => {
    const scope = effectScope()
    const gate = scope.run(() => useCanvasGate(ctxWith({ doc: true, media: true }), '特效'))!
    expect(gate.canUse.value).toBe(true)
    expect(gate.reason.value).toBe('')
    scope.stop()
  })
})
