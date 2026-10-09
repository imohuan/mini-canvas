/** token 单位换算 / 口径（用户口径 2026-10-09）—— 两态「已用预算 ⇄ 剩余预算」+ 单位缩写。 */
import { describe, it, expect } from 'vitest'
import { formatToken, budgetTokenText, parseTokenText, tokenDisplay, goalProgress } from '../queueModel'

describe('formatToken：按量级缩写', () => {
  it('国际单位 k / M / B / T', () => {
    expect(formatToken(999, 'si')).toBe('999')
    expect(formatToken(50000, 'si')).toBe('50k')
    expect(formatToken(1000000, 'si')).toBe('1M')
    expect(formatToken(2500000, 'si')).toBe('2.5M')
    expect(formatToken(1000000000, 'si')).toBe('1B')
    expect(formatToken(1e12, 'si')).toBe('1T')
  })
  it('中文单位 万 / 亿 / 万亿', () => {
    expect(formatToken(50000, 'cn')).toBe('5万')
    expect(formatToken(1000000, 'cn')).toBe('100万')
    expect(formatToken(100000000, 'cn')).toBe('1亿')
    expect(formatToken(1e12, 'cn')).toBe('1万亿')
  })
  it('一位小数、去掉尾随 .0；非有限数按 0', () => {
    expect(formatToken(12345, 'si')).toBe('12.3k')
    expect(formatToken(1000, 'si')).toBe('1k')
    expect(formatToken(NaN, 'si')).toBe('0')
    expect(formatToken(-5, 'si')).toBe('0')
  })
})

describe('budgetTokenText：预算（<=0 或不限）', () => {
  it('0 / -1 / 空 ⇒ 不限', () => {
    expect(budgetTokenText(0)).toBe('不限')
    expect(budgetTokenText(-1)).toBe('不限')
    expect(budgetTokenText(null)).toBe('不限')
  })
  it('正数按单位换算', () => {
    expect(budgetTokenText(50000, 'si')).toBe('50k')
    expect(budgetTokenText(50000, 'cn')).toBe('5万')
  })
})

describe('parseTokenText：把用户输入解析成数字', () => {
  it('纯数字 / 带逗号', () => {
    expect(parseTokenText('50000')).toBe(50000)
    expect(parseTokenText('1,048,576')).toBe(1048576)
  })
  it('k / m / b / t', () => {
    expect(parseTokenText('50k')).toBe(50000)
    expect(parseTokenText('1M')).toBe(1000000)
    expect(parseTokenText('2B')).toBe(2000000000)
  })
  it('万 / 亿 / 万亿', () => {
    expect(parseTokenText('5万')).toBe(50000)
    expect(parseTokenText('1亿')).toBe(100000000)
  })
  it('空 ⇒ -1（不限）；解析不了 ⇒ NaN', () => {
    expect(parseTokenText('')).toBe(-1)
    expect(parseTokenText('   ')).toBe(-1)
    expect(Number.isNaN(parseTokenText('abc'))).toBe(true)
  })
})

describe('tokenDisplay：两态「已用预算 / 剩余预算」', () => {
  const B = 1000000
  const U = 3700
  it('used ⇒ 已用预算', () => {
    expect(tokenDisplay('used', B, U)).toEqual({ prefix: '已用预算', value: '3.7k' })
  })
  it('left ⇒ 剩余预算 = 预算 − 已用', () => {
    expect(tokenDisplay('left', B, U)).toEqual({ prefix: '剩余预算', value: '996k' })
  })
  it('预算不限 ⇒ 强制回落「已用预算」（剩余没意义）', () => {
    expect(tokenDisplay('left', -1, U)).toEqual({ prefix: '已用预算', value: '3.7k' })
    expect(tokenDisplay('left', 0, U).prefix).toBe('已用预算')
  })
  it('剩余不会为负（已用 > 预算时按 0）', () => {
    expect(tokenDisplay('left', 1000, 5000)).toEqual({ prefix: '剩余预算', value: '0' })
  })
})

describe('goalProgress', () => {
  it('预算不限 ⇒ 0（没有分母）', () => {
    expect(goalProgress(-1, 5000)).toBe(0)
    expect(goalProgress(0, 5000)).toBe(0)
  })
  it('正常取整、夹在 0-100', () => {
    expect(goalProgress(1000, 370)).toBe(37)
    expect(goalProgress(1000, 5000)).toBe(100)
  })
})

