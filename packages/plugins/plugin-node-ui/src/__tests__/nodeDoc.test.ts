/**
 * 可视化节点说明书（nodeDoc）—— 用户 2026-10-14 口径：
 * 「每个可视化节点要有详细的功能描述，包括它自己的输入和输出」。
 *
 * 这里钉的是**写法宽容**这件事：作者（或 AI）随手写一行字也得认，
 * 认真写成对象也认。容忍写法差异是刻意的 —— 说明书本来就该由人轻松写出来，
 * 要求格式等于逼人不写。
 */
import { describe, it, expect } from 'vitest'
import {
  NODE_DOC_KEY,
  describeNodeDoc,
  nodeDocOf,
  normalizeIoEntry,
  normalizeNodeDoc,
} from '../task/nodeDoc'

describe('输入/输出的一条：几种写法都要认', () => {
  it('一行字', () => {
    expect(normalizeIoEntry('参考图')).toEqual({ name: '参考图' })
  })
  it('一行字带说明（中英文冒号都认）', () => {
    expect(normalizeIoEntry('参考图: 连进来的图')).toEqual({ name: '参考图', desc: '连进来的图' })
    expect(normalizeIoEntry('参考图：连进来的图')).toEqual({ name: '参考图', desc: '连进来的图' })
  })
  it('对象写法：name/type/desc', () => {
    expect(normalizeIoEntry({ name: '参考图', type: 'image', desc: '连进来的图' })).toEqual({
      name: '参考图',
      type: 'image',
      desc: '连进来的图',
    })
  })
  it('端口形状也能认（port / contentType / label 的别名）', () => {
    expect(normalizeIoEntry({ port: 'target', contentType: 'image' })).toEqual({ name: 'target', type: 'image' })
    expect(normalizeIoEntry({ label: '宫格图' })).toEqual({ name: '宫格图' })
  })
  it('认不出的（空串 / 数字 / null）→ undefined，不列空条目', () => {
    expect(normalizeIoEntry('')).toBeUndefined()
    expect(normalizeIoEntry('   ')).toBeUndefined()
    expect(normalizeIoEntry(42)).toBeUndefined()
    expect(normalizeIoEntry(null)).toBeUndefined()
    expect(normalizeIoEntry({})).toBeUndefined()
  })
})

describe('一份说明书：what 是硬门槛', () => {
  it('四件事齐全', () => {
    const doc = normalizeNodeDoc({
      what: '把视频转成宫格图',
      effect: '建出来能看到一张九宫格',
      inputs: ['视频', { name: '列数', type: 'number', desc: '几列' }],
      outputs: ['宫格图'],
    })
    expect(doc).toEqual({
      what: '把视频转成宫格图',
      effect: '建出来能看到一张九宫格',
      inputs: [{ name: '视频' }, { name: '列数', type: 'number', desc: '几列' }],
      outputs: [{ name: '宫格图' }],
    })
  })

  it('没有 what 就当没写（不返回半空壳）', () => {
    expect(normalizeNodeDoc({ effect: '好看' })).toBeUndefined()
    expect(normalizeNodeDoc({})).toBeUndefined()
    expect(normalizeNodeDoc('把视频转宫格')).toBeUndefined()
    expect(normalizeNodeDoc(null)).toBeUndefined()
  })

  it('desc / summary 也当 what（同一件事的不同说法）', () => {
    expect(normalizeNodeDoc({ desc: '转宫格' })?.what).toBe('转宫格')
    expect(normalizeNodeDoc({ summary: '转宫格' })?.what).toBe('转宫格')
  })

  it('inputs 写单个（不是数组）也认', () => {
    expect(normalizeNodeDoc({ what: 'x', inputs: '视频' })?.inputs).toEqual([{ name: '视频' }])
  })
})

describe('从节点 data 里读', () => {
  it('键就是 NODE_DOC_KEY', () => {
    const data = { [NODE_DOC_KEY]: { what: '干这个' } }
    expect(NODE_DOC_KEY).toBe('uiNodeDoc')
    expect(nodeDocOf(data)?.what).toBe('干这个')
  })
  it('data 不是对象 / 没这个键 → undefined', () => {
    expect(nodeDocOf(undefined)).toBeUndefined()
    expect(nodeDocOf({})).toBeUndefined()
    expect(nodeDocOf('x')).toBeUndefined()
    expect(nodeDocOf([1, 2])).toBeUndefined()
  })
})

describe('渲染成给 AI 看的那几行', () => {
  it('四件事都摊出来', () => {
    const text = describeNodeDoc({
      what: '转宫格',
      effect: '一眼看全',
      inputs: [{ name: '视频', type: 'video' }],
      outputs: [{ name: '宫格图', desc: '九宫格' }],
    })
    expect(text).toContain('做什么：转宫格')
    expect(text).toContain('效果：一眼看全')
    expect(text).toContain('输入 视频')
    expect(text).toContain('[video]')
    expect(text).toContain('输出 宫格图')
    expect(text).toContain('九宫格')
  })

  it('没写说明书 → 明说没写（不是留一句空的）', () => {
    expect(describeNodeDoc(undefined)).toContain('没有写说明书')
  })
})
