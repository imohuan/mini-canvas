/**
 * 后台地址唯一规则：只认 http(s) 绝对地址，其余当同源。
 *
 * 回归的是真机问题（2026-11-05）：设置里 `cloudClientBaseUrl` 被存成了一个「的」字，
 * 三处拼接原样采用，浏览器发出 `/%E7%9A%84/api/history` → 404、控制台刷警告。
 */
import { describe, expect, it } from 'vitest'
import { apiUrl, apiUrlFrom, normalizeApiBase } from './apiBase'

describe('normalizeApiBase', () => {
  it('合法 http(s) 地址：去尾部斜杠后原样返回', () => {
    expect(normalizeApiBase('http://127.0.0.1:8865/')).toBe('http://127.0.0.1:8865')
    expect(normalizeApiBase(' https://canvas.example.com/base// ')).toBe('https://canvas.example.com/base')
  })

  it('空值 / 脏值 / 相对路径一律当同源（返回空串）', () => {
    for (const bad of ['', '   ', undefined, null, 42, '的', '/api', 'api', '//host:8865', 'localhost:8865']) {
      expect(normalizeApiBase(bad), String(bad)).toBe('')
    }
  })
})

describe('apiUrl', () => {
  it('base 为空 = 同源相对路径', () => {
    expect(apiUrl('', '/api/history')).toBe('/api/history')
  })

  it('base 有值时补斜杠，不拼出双斜杠', () => {
    expect(apiUrl('http://x:8865', '/api/history')).toBe('http://x:8865/api/history')
    expect(apiUrl('http://x:8865', 'api/history')).toBe('http://x:8865/api/history')
  })

  it('path 本身是绝对地址时原样返回（资源完整地址不二次拼接）', () => {
    expect(apiUrl('http://x:8865', 'https://cdn/a.png')).toBe('https://cdn/a.png')
  })
})

describe('apiUrlFrom：脏地址不会再被拼进请求', () => {
  it('存成「的」也不影响请求地址', () => {
    expect(apiUrlFrom('的', '/api/history')).toBe('/api/history')
  })

  it('合法地址正常拼接', () => {
    expect(apiUrlFrom('http://127.0.0.1:8865/', '/api/history')).toBe('http://127.0.0.1:8865/api/history')
  })
})
