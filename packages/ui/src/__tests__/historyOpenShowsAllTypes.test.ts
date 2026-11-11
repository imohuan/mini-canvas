/**
 * 打开生成历史时不能停在空页签。
 *
 * 现场（2026-11-11）：音频页签显示“音频 5”，列表却是空的 —— 打开时停在“图片”页签，
 * 而这张画布没有图片。计数徽章说明有内容，列表却被空页签挡住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const shell = readFileSync(
  new URL('../composables/ui/useShellControls.ts', import.meta.url),
  'utf-8',
)

describe('生成历史打开时的筛选', () => {
  it('每次打开都回到全部类型（不能停在空的图片页签）', () => {
    const fn = shell.slice(shell.indexOf('function toggleHistory'), shell.indexOf('function toggleLeftCollapsed'))
    expect(fn, '找不到 toggleHistory').not.toBe('')
    // 赋值行为必须真的把类型清空；只写注释不算
    expect(fn, '打开历史没有清空类型筛选，会停在空页签').toMatch(/state\.histType\s*=\s*''/)
    // 必须在 openHistoryView 之前改：否则签名仍按旧页签拼，请求会拿到空结果
    expect(fn.indexOf("state.histType = ''"), '清空类型发生在拉数据之后，等于没做')
      .toBeLessThan(fn.indexOf('history.openHistoryView()'))
  })
})
