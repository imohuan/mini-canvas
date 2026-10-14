/**
 * 后台功能函数的说明书（fnDoc）—— 用户 2026-10-14 口径：
 * 「对每个导出工具详细说明：工具做什么 / 输入参数有哪些 / 返回结果是什么 / 调用示例」。
 *
 * 钉两件事：
 *   ① 作者写的说明书要能被规整出来（写法宽容）；
 *   ② **真实导出为准** —— 说明书里写了但脚本里没有的函数不列（过期文档不该当真）。
 */
import { describe, it, expect } from 'vitest'
import { describeFunction, mergeFunctions, normalizeArgDoc, normalizeScriptDocs } from '../task/fnDoc'

describe('一条参数', () => {
  it('一行字 / 一行字带说明 / 对象三种写法', () => {
    expect(normalizeArgDoc('width')).toEqual({ name: 'width' })
    expect(normalizeArgDoc('width: 目标宽度')).toEqual({ name: 'width', desc: '目标宽度' })
    expect(normalizeArgDoc({ name: 'width', type: 'number', required: true, desc: '目标宽度' })).toEqual({
      name: 'width',
      type: 'number',
      required: true,
      desc: '目标宽度',
    })
  })
  it('别名 key / arg 也认；认不出 → undefined', () => {
    expect(normalizeArgDoc({ key: 'w' })).toEqual({ name: 'w' })
    expect(normalizeArgDoc({ arg: 'w' })).toEqual({ name: 'w' })
    expect(normalizeArgDoc('')).toBeUndefined()
    expect(normalizeArgDoc(7)).toBeUndefined()
  })
})

describe('一份脚本的说明书', () => {
  it('四件事都收（what / args / returns / example）', () => {
    const docs = normalizeScriptDocs({
      scale: {
        what: '缩放图片',
        args: [{ name: 'width', type: 'number', required: true }],
        returns: '缩放后的地址',
        example: 'scale(640)',
      },
    })
    expect(docs.scale).toEqual({
      what: '缩放图片',
      args: [{ name: 'width', type: 'number', required: true }],
      returns: '缩放后的地址',
      example: 'scale(640)',
    })
  })
  it('字段别名：params / output / usage', () => {
    const docs = normalizeScriptDocs({
      run: { what: '跑', params: ['a'], output: '结果', usage: 'run("a")' },
    })
    expect(docs.run?.args).toEqual([{ name: 'a' }])
    expect(docs.run?.returns).toBe('结果')
    expect(docs.run?.example).toBe('run("a")')
  })
  it('没有 what 的条目直接丢（不产生「无说明」的空条目）', () => {
    expect(normalizeScriptDocs({ x: { args: ['a'] } })).toEqual({})
    expect(normalizeScriptDocs(null)).toEqual({})
    expect(normalizeScriptDocs([1, 2])).toEqual({})
  })
})

describe('与真实导出合并：真实导出为准', () => {
  it('作者写了说明书、脚本里也有 → 合并', () => {
    const out = mergeFunctions('scale', ['run'], { run: { what: '缩放', args: [{ name: 'w' }] } })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ script: 'scale', fn: 'run', what: '缩放', args: [{ name: 'w' }] })
  })

  it('★ 说明书里写了但脚本里没有 → 不列（过期文档不该当真）', () => {
    const out = mergeFunctions('scale', ['run'], { gone: { what: '早就删了' } })
    expect(out.map((f) => f.fn)).toEqual(['run'])
  })

  it('★ 脚本里有但没写说明书 → 照样列（否则这个功能永远发现不了）', () => {
    const out = mergeFunctions('scale', ['run', 'probe'], { run: { what: '缩放' } })
    expect(out.map((f) => f.fn)).toEqual(['run', 'probe'])
    expect(out[1].what).toBeUndefined()
    expect(out[1].args).toEqual([])
  })
})

describe('渲染成给 AI 看的那几行', () => {
  it('四件事都摊出来', () => {
    const text = describeFunction({
      script: 'scale',
      fn: 'run',
      what: '缩放图片',
      args: [{ name: 'width', type: 'number', required: true, desc: '目标宽度' }],
      returns: '地址',
      example: 'scale(640)',
    })
    expect(text).toContain('scale.run：缩放图片')
    expect(text).toContain('width:number（必填） 目标宽度')
    expect(text).toContain('返回：地址')
    expect(text).toContain('示例：scale(640)')
  })
  it('没写说明书要说出来，而不是假装没有参数', () => {
    const text = describeFunction({ script: 's', fn: 'f', args: [] })
    expect(text).toContain('没写说明书')
    expect(text).toContain('参数：无')
  })
})
