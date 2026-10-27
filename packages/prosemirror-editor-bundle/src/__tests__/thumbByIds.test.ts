/**
 * 按 id 列表换缩略图（用户 2026-10-27）。
 *
 * 为什么需要：拖拽排序后标签名不变、指向的图变了，按名字匹配会漏/错；
 * 而正文里的标签有两种身份（节点 id / ref-slot:kind:N），两种都要能命中。
 * 硬约束：只改 url，**绝不改 name**（名字是用户提示词里的引用名）。
 */
import { describe, expect, it } from 'vitest'
import { parsePlainTextToContent, applyThumbByIds } from '../useEditor.ts'

/** 借 parsePlainTextToContent 拿 schema（编辑器用的就是这一份） */
const schema = parsePlainTextToContent('<ref type="node" name="图片1" canvasId="c" nodeId="1" />', undefined)[0].type.schema

const docWith = (attrs: Record<string, unknown>) =>
  schema.node('doc', null, [
    schema.node('paragraph', null, [schema.nodes.resource.create(attrs)]),
  ])

describe('applyThumbByIds', () => {
  it('命中 ref-slot id → 换 url，name 不变', () => {
    const doc = docWith({ id: 'ref-slot:image:1', name: '图片3', url: 'old.png', category: '素材' })
    const out = applyThumbByIds(doc, ['ref-slot:image:1'], 'new.png')
    const node = out.child(0).child(0)
    expect(node.attrs.url).toBe('new.png')
    expect(node.attrs.name).toBe('图片3')
  })

  it('命中节点 id（资源面板插入的标签）→ 同样只换 url', () => {
    const doc = docWith({ id: 'node-9', name: '图片2', url: 'a.png', category: '素材' })
    const out = applyThumbByIds(doc, ['node-9'], 'b.png')
    expect(out.child(0).child(0).attrs.url).toBe('b.png')
    expect(out.child(0).child(0).attrs.name).toBe('图片2')
  })

  it('id 列表里两种身份混着给，都能命中', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.nodes.resource.create({ id: 'ref-slot:image:1', name: '图片1', url: 'a.png', category: '素材' }),
        schema.nodes.resource.create({ id: 'node-9', name: '图片2', url: 'b.png', category: '素材' }),
      ]),
    ])
    const out = applyThumbByIds(doc, ['ref-slot:image:1', 'node-9'], 'z.png')
    expect(out.child(0).child(0).attrs.url).toBe('z.png')
    expect(out.child(0).child(1).attrs.url).toBe('z.png')
  })

  it('id 对不上 → 原样返回同一个引用（不产生无谓改动）', () => {
    const doc = docWith({ id: 'x', name: '图片1', url: 'a.png', category: '素材' })
    expect(applyThumbByIds(doc, ['nope'], 'b.png')).toBe(doc)
  })

  it('url 已经相同 → 也算没变，返回同一引用', () => {
    const doc = docWith({ id: 'x', name: '图片1', url: 'a.png', category: '素材' })
    expect(applyThumbByIds(doc, ['x'], 'a.png')).toBe(doc)
  })

  it('空 id 列表 → 原样返回', () => {
    const doc = docWith({ id: 'x', name: '图片1', url: 'a.png', category: '素材' })
    expect(applyThumbByIds(doc, [], 'b.png')).toBe(doc)
  })
})

