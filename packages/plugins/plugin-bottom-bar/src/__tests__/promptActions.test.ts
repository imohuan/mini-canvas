/**
 * promptActions 的判定契约（纯逻辑，Node 可测）。
 * 锁两件事：不重复追加；再点一次能干净地撤回。
 */
import { describe, it, expect } from 'vitest'
import {
  TRANSLATE_INSTRUCTION,
  hasTranslateInstruction,
  withTranslateInstruction,
  withoutTranslateInstruction,
  toggleTranslateInstruction,
} from '../promptActions'

describe('promptActions：翻译指令', () => {
  it('空提示词 → 只有指令本身（不留前导空格）', () => {
    expect(withTranslateInstruction('')).toBe(TRANSLATE_INSTRUCTION)
  })

  it('有提示词 → 指令追加在后面，中间一个空格', () => {
    const out = withTranslateInstruction('一只猫')
    expect(out.startsWith('一只猫 ')).toBe(true)
    expect(hasTranslateInstruction(out)).toBe(true)
  })

  it('已经加过 → 不重复追加（幂等）', () => {
    const once = withTranslateInstruction('一只猫')
    expect(withTranslateInstruction(once)).toBe(once)
  })

  it('撤回：恢复到原文，且不留尾随空格', () => {
    const once = withTranslateInstruction('一只猫')
    expect(withoutTranslateInstruction(once)).toBe('一只猫')
    expect(hasTranslateInstruction(withoutTranslateInstruction(once))).toBe(false)
  })

  it('没加过时撤回 = 原样（不做多余改动）', () => {
    expect(withoutTranslateInstruction('一只猫')).toBe('一只猫')
    expect(withoutTranslateInstruction('')).toBe('')
  })

  it('toggle：一下加上、两下还原', () => {
    const a = toggleTranslateInstruction('一只猫')
    expect(hasTranslateInstruction(a)).toBe(true)
    expect(toggleTranslateInstruction(a)).toBe('一只猫')
  })
})

