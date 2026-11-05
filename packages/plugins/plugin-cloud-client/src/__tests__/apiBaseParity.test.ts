/**
 * cloud-client 的产物要求零 import，所以它把「后台地址校验」就地内联了一份。
 * 这条测试保证内联副本与 `@mini-canvas/bar-contract` 的唯一真源行为一致 ——
 * 改一边忘了另一边，会在这里红。
 */
import { describe, expect, it } from 'vitest'
import { normalizeApiBase } from '@mini-canvas/bar-contract'
import { configFrom } from '../config'

/** 用 configFrom 读同一份 settings，间接覆盖内联实现的输出。 */
function baseUrlOf(value: unknown): string {
  return configFrom({ get: (key) => (key === 'cloudClientBaseUrl' ? value : undefined) }).baseUrl
}

// 用户实测被存进设置里的脏值（单个汉字）；用码点拼，避免源码里出现孤立字符。
const DIRTY = String.fromCharCode(0x7684)

describe('cloud-client 的地址校验与 bar-contract 一致', () => {
  const cases: unknown[] = [
    '',
    '   ',
    undefined,
    null,
    DIRTY,
    '/api',
    'localhost:8865',
    '//host:8865',
    'http://127.0.0.1:8865/',
    'https://canvas.example.com/base//',
  ]

  it('同一输入下两边结果逐条相同', () => {
    for (const value of cases) {
      expect(baseUrlOf(value), String(value)).toBe(normalizeApiBase(value))
    }
  })

  it('脏值不会成为服务地址（用户实测）：回落同源', () => {
    expect(baseUrlOf(DIRTY)).toBe('')
  })
})
