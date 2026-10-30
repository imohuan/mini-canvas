/**
 * 3D 预览卸载时必须主动丢 WebGL 上下文（2026-10-30 扫描发现）。
 *
 * disposeThree 调了 renderer.dispose() 和 domElement.remove()，但没调
 * forceContextLoss()。浏览器对同时存在的 WebGL 上下文有硬上限（通常 16 个），
 * 只 dispose 时要等 GC 才真正释放 —— 画布上几十个 3D 节点来回切、或反复进全屏，
 * 很容易撞上限，之后的 3D 预览整块变黑。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../PanoramaContent.vue', import.meta.url), 'utf-8')

describe('3D 预览释放', () => {
  it('disposeThree 里丢了 WebGL 上下文', () => {
    const at = src.indexOf('function disposeThree(')
    expect(at).toBeGreaterThan(0)
    const block = src.slice(at, src.indexOf('onMounted(', at))
    expect(block, '没有 forceContextLoss（上下文要等 GC 才释放）').toMatch(/forceContextLoss/)
  })
})
