import { describe, it, expect } from 'vitest'
import { defaultBody, placeholderOf, codeOf } from './testLogic'

describe('defaultBody（端点默认请求体）', () => {
  it('GET/DELETE 无 body', () => {
    expect(defaultBody('GET', '/api/showcase/hello')).toBeUndefined()
    expect(defaultBody('DELETE', '/api/showcase/todos/:id')).toBeUndefined()
  })

  it('echo / todos / store / jobs 各给演示 body', () => {
    expect(defaultBody('POST', '/api/showcase/echo')).toEqual({ hello: 'showcase', n: 1 })
    expect(defaultBody('POST', '/api/showcase/todos')).toEqual({ title: '手动创建的一条 todo' })
    expect(defaultBody('PUT', '/api/showcase/todos/:id')).toEqual({ done: true })
    expect(defaultBody('PUT', '/api/showcase/store/notes/:key', new Date(0))).toEqual({
      note: '写在插件私有存储里的值',
      at: new Date(0).toISOString(),
    })
    expect(defaultBody('POST', '/api/showcase/jobs/heartbeat')).toEqual({ intervalMs: 1000 })
  })
})

describe('placeholderOf（:id 真实取值链 —— 附录 B.9 的坑）', () => {
  it('todos/:id 需要先建一条拿真 id；store/:key 用固定演示键', () => {
    expect(placeholderOf('/api/showcase/todos/:id')).toEqual({ kind: 'todo-id' })
    expect(placeholderOf('/api/showcase/store/notes/:key')).toEqual({ kind: 'store-key' })
    expect(placeholderOf('/api/showcase/hello')).toBeNull()
  })
})

describe('codeOf（在线文档的 fetch 示例）', () => {
  it('GET：只有 url', () => {
    expect(codeOf({ method: 'GET', path: '/api/showcase/hello' })).toBe('await fetch("/api/showcase/hello", {\n})')
  })

  it('POST：带 method + JSON body', () => {
    const code = codeOf({ method: 'POST', path: '/api/showcase/echo' })
    expect(code).toContain("method: 'POST'")
    expect(code).toContain('JSON.stringify({"hello":"showcase","n":1})')
  })
})
