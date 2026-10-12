import { describe, it, expect } from 'vitest'
import { normalizeManualValues, resolveInputValues, valueSourceOf } from '../uiValues'
import type { UiInputDecl, UpstreamItem } from '../uiData'

const upstream: UpstreamItem[] = [
  { refName: '图片1', kind: 'image', url: '/a.png' },
  { refName: '文本1', kind: 'text', value: '{"a":1}' },
  { refName: '文本2', kind: 'text', value: '42' },
]

describe('手工值归一', () => {
  it('只收标量，数组/对象/函数丢掉', () => {
    expect(normalizeManualValues({ a: 'x', b: 1, c: true, d: [1], e: { x: 1 }, f: () => 1 })).toEqual({
      a: 'x',
      b: 1,
      c: true,
    })
  })
  it('不是对象 = 空', () => {
    expect(normalizeManualValues(null)).toEqual({})
    expect(normalizeManualValues([1, 2])).toEqual({})
  })
})

describe('取值优先级', () => {
  it('① 手工填的最权威', () => {
    const decls: UiInputDecl[] = [{ key: '封面', type: 'image' }]
    const v = resolveInputValues(decls, upstream, { 封面: '自定义.png' })
    expect(v).toEqual({ 封面: '自定义.png' })
  })

  it('② 引用名对得上的上游素材', () => {
    const decls: UiInputDecl[] = [{ key: '图片1', type: 'image' }]
    expect(resolveInputValues(decls, upstream)).toEqual({ 图片1: '/a.png' })
  })

  it('③ 名字对不上时按同类型兜底（用户只做了一次"连线"）', () => {
    const decls: UiInputDecl[] = [{ key: 'cover', type: 'image' }]
    expect(resolveInputValues(decls, upstream)).toEqual({ cover: '/a.png' })
  })

  it('取不到就如实留 null（界面能画"暂无数据"）', () => {
    const decls: UiInputDecl[] = [{ key: 'missing', type: 'image' }]
    expect(resolveInputValues(decls, [])).toEqual({ missing: null })
  })

  it('一个素材不会被两个参数重复吃掉', () => {
    const decls: UiInputDecl[] = [
      { key: 'a', type: 'image' },
      { key: 'b', type: 'image' },
    ]
    const v = resolveInputValues(decls, upstream)
    expect(v.a).toBe('/a.png')
    expect(v.b).toBe(null)
  })

  it('number 类型把文本转成数字；转不了给 null', () => {
    const decls: UiInputDecl[] = [
      { key: 'n', type: 'number' },
      { key: 'm', type: 'number' },
    ]
    // 文本1 是被 n 吃掉的（同类型兜底），m 再取同类型的 文本2 = "42"
    const v = resolveInputValues(decls, upstream)
    expect(v.n).toBe(null) // "{"a":1}" 不是数字 → null
    expect(v.m).toBe(42)
  })

  it('json / table 类型能解析 JSON 文本', () => {
    const decls: UiInputDecl[] = [{ key: 'rows', type: 'table' }]
    expect(resolveInputValues(decls, upstream)).toEqual({ rows: { a: 1 } })
  })

  it('boolean 类型认 true/1/是', () => {
    const decls: UiInputDecl[] = [{ key: 'flag', type: 'boolean' }]
    const v = resolveInputValues(decls, [{ refName: 'x', kind: 'text', value: '是' }])
    expect(v.flag).toBe(true)
  })
})

describe('取值来源提示（面板上显示这一条的值从哪来）', () => {
  const decl: UiInputDecl = { key: 's', type: 'text' }
  it('手工 / 上游 / 无', () => {
    expect(valueSourceOf(decl, [], { s: 'x' }).from).toBe('manual')
    expect(valueSourceOf(decl, upstream, {}).from).toBe('upstream')
    expect(valueSourceOf(decl, [], {}).from).toBe('none')
  })
})

