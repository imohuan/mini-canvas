import { describe, it, expect } from 'vitest'
import { NodeRegistry } from '../nodeRegistry'
import { resolveSegment, hasContent, activeSegments } from '../nodeRenderer'

/** 测试里的组件 stub（内核不 import Vue，组件是 opaque 句柄即可） */
const TextContentStub = { name: 'TextContent' }
const ImgContentStub = { name: 'ImageContent' }
const TextTitleStub = { name: 'TextTitle' }

function seed(): NodeRegistry {
  const r = new NodeRegistry()
  r.register('text', { content: TextContentStub, title: TextTitleStub })
  r.register('image', { content: ImgContentStub })
  return r
}

describe('nodeRegistry（节点展示注册表，纯逻辑）', () => {
  it('register 后经 get/has 可查，segments 原样保留', () => {
    const r = new NodeRegistry()
    r.register('text', { content: TextContentStub })
    expect(r.has('text')).toBe(true)
    expect(r.has('image')).toBe(false)
    expect(r.get('text')?.segments.content).toBe(TextContentStub)
    expect(r.types()).toEqual(['text'])
  })

  it('同 type 重复 register 抛错（防覆盖）', () => {
    const r = new NodeRegistry()
    r.register('text', { content: TextContentStub })
    expect(() => r.register('text', { content: ImgContentStub })).toThrow(/already registered/i)
  })

  it('set 可覆盖升级（宿主热更），未注册也直接建', () => {
    const r = new NodeRegistry()
    r.set('text', { content: TextContentStub })
    r.set('text', { content: ImgContentStub })
    expect(r.get('text')?.segments.content).toBe(ImgContentStub)
    r.set('brand-new', { content: TextContentStub })
    expect(r.has('brand-new')).toBe(true)
  })
})

describe('NodeRenderer（type → 段组件解析，纯逻辑）', () => {
  const r = seed()

  it('text → content 解析回其注册的组件', () => {
    expect(resolveSegment(r, 'text', 'content')).toBe(TextContentStub)
    expect(resolveSegment(r, 'image', 'content')).toBe(ImgContentStub)
  })

  it('未注册的 type / 没给的段 → undefined（调用方缺省渲染）', () => {
    expect(resolveSegment(r, 'video', 'content')).toBeUndefined()
    expect(resolveSegment(r, 'text', 'top-toolbar')).toBeUndefined()
  })

  it('activeSegments 只列出真的给了组件的段，text 含 title、image 不含', () => {
    expect(activeSegments(r, 'text')).toEqual(['content', 'title'])
    expect(activeSegments(r, 'image')).toEqual(['content'])
    expect(activeSegments(r, 'video')).toEqual([])
  })

  it('hasContent 区分显式注册 content 与否', () => {
    expect(hasContent(r, 'text')).toBe(true)
    expect(hasContent(r, 'video')).toBe(false)
  })
})
