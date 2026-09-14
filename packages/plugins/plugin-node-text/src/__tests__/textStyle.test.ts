/**
 * textStyle 单测 —— **只测字数/行数统计**（纯函数，不挂浏览器）。
 *
 * 历史说明：本文件原先还测字号档位 / 对齐循环 / 颜色循环 / 加粗开关 / resolveTextStyle。
 * 用户明确表示文字的"样式"概念对文本节点没有意义，顶部操作条与整套样式字段已删除，
 * 对应用例一并移除——本文件只留底部状态栏用得到的统计口径。
 */
import { describe, it, expect } from 'vitest'
import { countChars, countLines, summarizeText } from '../textStyle'

describe('字数与行数', () => {
  it('字符数不含空白', () => {
    expect(countChars('a b\nc')).toBe(3)
    expect(countChars('   ')).toBe(0)
    expect(countChars('')).toBe(0)
    expect(countChars(undefined)).toBe(0)
  })

  it('行数按换行符算，空文本 0 行', () => {
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a')).toBe(1)
    expect(countLines('')).toBe(0)
    expect(countLines(undefined)).toBe(0)
  })

  it('摘要把两个口径合并，避免两处各写一遍', () => {
    expect(summarizeText('ab\ncd')).toEqual({ chars: 4, lines: 2 })
    expect(summarizeText(undefined)).toEqual({ chars: 0, lines: 0 })
  })
})
