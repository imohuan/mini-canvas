/**
 * panoramaMode —— 3D 预览节点"两种模式"的判定契约。
 *
 * 用户要求（原话）："3D 预览节点这个地方也有 2 种模式的，也是双击进入，进入之后可以转动视角，
 * 默认模式下是用来拖拽节点的"。
 *
 * 这里把上面那句话钉成三条可断言的规则：
 * 1. 默认模式**不接管指针** → 按住画面就是拖节点；
 * 2. 进入交互模式后才接管指针与滚轮 → 拖拽转视角、滚轮改视野角，且滚轮不再缩画布；
 * 3. 渲染失败时一律不接管（画面都不可用了，别再让节点拖不动）。
 */
import { describe, it, expect } from 'vitest'
import { resolveEscapeAction, resolvePanoramaSpec } from '../panoramaMode'

const base = { interactive: false, fullscreen: false, hasError: false }

describe('默认（预览）模式：用来拖节点', () => {
  it('不接管指针 —— 按住画面拖的是节点本身', () => {
    const spec = resolvePanoramaSpec(base)
    expect(spec.mode).toBe('preview')
    expect(spec.interactive).toBe(false)
    expect(spec.capturePointer).toBe(false)
  })

  it('不抢滚轮（滚轮照旧归画布缩放）', () => {
    expect(resolvePanoramaSpec(base).captureWheel).toBe(false)
  })

  it('不再提供任何常驻画面文案（用户要求删掉提醒，避免遮挡视线）', () => {
    const spec = resolvePanoramaSpec(base) as unknown as Record<string, unknown>
    expect(spec.hint).toBeUndefined()
    expect(spec.showReset).toBeUndefined()
  })
})

describe('交互模式（双击进入）：用来转视角', () => {
  it('接管指针 —— 拖拽转视角', () => {
    const spec = resolvePanoramaSpec({ ...base, interactive: true })
    expect(spec.mode).toBe('interactive')
    expect(spec.capturePointer).toBe(true)
  })

  it('抢滚轮 —— 滚轮改视野角，不再缩放画布', () => {
    expect(resolvePanoramaSpec({ ...base, interactive: true }).captureWheel).toBe(true)
  })

  it('不再有重置按钮（用户要求删掉右上角按钮，重置改成 r 快捷键）', () => {
    const spec = resolvePanoramaSpec({ ...base, interactive: true }) as unknown as Record<string, unknown>
    expect(spec.showReset).toBeUndefined()
  })
})

describe('全屏（f 切换）', () => {
  it('全屏是"更强的交互"：接管指针与滚轮，进去就能转能缩', () => {
    const spec = resolvePanoramaSpec({ ...base, fullscreen: true })
    expect(spec.mode).toBe('fullscreen')
    expect(spec.fullscreen).toBe(true)
    expect(spec.capturePointer).toBe(true)
    expect(spec.captureWheel).toBe(true)
  })

  it('全屏优先于普通交互模式（模式名不互相覆盖）', () => {
    expect(resolvePanoramaSpec({ ...base, interactive: true, fullscreen: true }).mode).toBe('fullscreen')
  })

  it('退出全屏回到普通交互模式（还在节点里）', () => {
    const spec = resolvePanoramaSpec({ ...base, interactive: true, fullscreen: false })
    expect(spec.mode).toBe('interactive')
    expect(spec.fullscreen).toBe(false)
  })
})

describe('渲染失败：降级成纯说明', () => {
  it('什么都不接管（否则节点会变成拖不动的死块）', () => {
    const spec = resolvePanoramaSpec({ ...base, hasError: true, interactive: true, fullscreen: true })
    expect(spec.mode).toBe('error')
    expect(spec.capturePointer).toBe(false)
    expect(spec.captureWheel).toBe(false)
    expect(spec.fullscreen).toBe(false)
  })
})

describe('Esc 一次只退一层', () => {
  it('全屏时 → 只退全屏（人仍留在交互态，和老版一致）', () => {
    expect(resolveEscapeAction({ fullscreen: true, interactive: true })).toBe('exit-fullscreen')
  })

  it('已退出全屏（仍在交互）→ 退交互，回到可拖节点', () => {
    expect(resolveEscapeAction({ fullscreen: false, interactive: true })).toBe('exit-interact')
  })

  it('什么都没进 → 什么都不做（不误触）', () => {
    expect(resolveEscapeAction({ fullscreen: false, interactive: false })).toBe('none')
  })

  it('理论上不该出现的"全屏但不在交互"→ 仍按退全屏处理，不会卡住', () => {
    expect(resolveEscapeAction({ fullscreen: true, interactive: false })).toBe('exit-fullscreen')
  })
})
