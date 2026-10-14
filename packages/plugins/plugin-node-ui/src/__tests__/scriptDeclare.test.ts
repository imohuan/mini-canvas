/**
 * 依赖声明 + 调用授权（2026-10-13 用户拍板的强制约束）。
 *
 * 这一组测试钉的是"AI 忘了声明会怎样"：界面照样能画出来，但**调不动**，
 * 且报错里写了该怎么补 —— 能自愈，不是卡死。
 */
import { describe, it, expect } from 'vitest'
import { detectScriptCalls, mergeDeclared } from '../task/declare'
import { authorizeScriptCall, declaredNames } from '../task/authorize'

describe('detectScriptCalls —— 从界面里扫出它调了哪些脚本', () => {
  it('认出手册教的那个写法（type/name 都在）', () => {
    const html = 'fetch(base + "/api/task/call", { method: "POST", body: JSON.stringify({ type: "call", name: "scale", methods: "run" }) })'
    expect(detectScriptCalls(html, ['scale'])).toEqual(['scale'])
  })

  it('三种引号写法都认', () => {
    expect(detectScriptCalls('{"name": "a"}', ['a'])).toEqual(['a'])
    expect(detectScriptCalls("{'name': 'b'}", ['b'])).toEqual(['b'])
    expect(detectScriptCalls('{ name: "c" }', ['c'])).toEqual(['c'])
  })

  it('**只认机器上真有的脚本名** —— 界面里满地是 name: "xxx"，不过滤就是噪音', () => {
    const html = '{ name: "我的输入框" }, { name: "scale" }, { name: "不存在的脚本" }'
    expect(detectScriptCalls(html, ['scale'])).toEqual(['scale'])
  })

  it('filename: "x" 这类不该被当成脚本调用', () => {
    expect(detectScriptCalls('{ filename: "scale" }', ['scale'])).toEqual([])
  })

  it('空 HTML / 没有已知脚本 → 空（绝不凭空造声明）', () => {
    expect(detectScriptCalls('', ['scale'])).toEqual([])
    expect(detectScriptCalls('{ name: "scale" }', [])).toEqual([])
  })
})

describe('mergeDeclared —— 合并声明（AI 写的优先，绝不覆盖）', () => {
  it('已有的条目一个都不丢，新发现的补上', () => {
    const out = mergeDeclared({ scale: { sha256: 'aaa', at: 1 } }, ['crop'], () => 'bbb', 99)
    expect(out.scale).toEqual({ sha256: 'aaa', at: 1 })
    expect(out.crop).toEqual({ sha256: 'bbb', at: 99 })
  })

  it('已有哈希优先 —— 不因为又扫了一次就把 hash 刷成"当时那份"', () => {
    const out = mergeDeclared({ scale: { sha256: 'old' } }, ['scale'], () => 'new', 99)
    expect(out.scale.sha256).toBe('old')
  })

  it('形状不对的旧值当没有（不炸）', () => {
    expect(mergeDeclared('nope', ['a'], () => undefined, 1)).toEqual({ a: { at: 1 } })
    expect(mergeDeclared([1, 2], ['a'], () => undefined, 1)).toEqual({ a: { at: 1 } })
  })

  it('非法脚本名进不来（与脚本目录同一套白名单）', () => {
    const out = mergeDeclared({}, ['../evil', 'a/b'], () => undefined, 1)
    expect(out).toEqual({})
  })
})

describe('authorizeScriptCall —— 没声明就不让跑', () => {
  const base = { canvasId: 'default', nodeId: '3' }

  it('声明里有 → 放行', () => {
    const r = authorizeScriptCall({ ...base, scriptName: 'scale', nodeData: { uiScripts: { scale: {} } }, nodeExists: true })
    expect(r.ok).toBe(true)
  })

  it('声明里没有 → 拒，且报错里**写清该怎么补**（AI 要能自愈）', () => {
    const r = authorizeScriptCall({ ...base, scriptName: 'crop', nodeData: { uiScripts: { scale: {} } }, nodeExists: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('crop')
    expect(r.error).toContain('scale')      // 顺带告诉它已经声明了什么
    expect(r.error).toContain('uiScripts')  // 以及该改哪个字段
  })

  it('完全没声明过 → 一样拒（不能"没写就等于默认放行"）', () => {
    const r = authorizeScriptCall({ ...base, scriptName: 'scale', nodeData: {}, nodeExists: true })
    expect(r.ok).toBe(false)
  })

  it('节点不存在 → 拒（nodeId 是调用方自己填的，不能拿它当后门）', () => {
    const r = authorizeScriptCall({ ...base, scriptName: 'scale', nodeData: undefined, nodeExists: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('没有节点')
  })

  it('缺 nodeId → 拒', () => {
    const r = authorizeScriptCall({ canvasId: 'default', nodeId: '', scriptName: 'scale', nodeData: { uiScripts: { scale: {} } }, nodeExists: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('nodeId')
  })
})

describe('declaredNames —— 声明读取的健壮性', () => {
  it('正常形状：取出键', () => {
    expect(declaredNames({ uiScripts: { a: {}, b: {} } }).sort()).toEqual(['a', 'b'])
  })
  it('字段缺失 / 类型不对 → 空（当没声明，走拒绝）', () => {
    expect(declaredNames({})).toEqual([])
    expect(declaredNames(undefined)).toEqual([])
    expect(declaredNames({ uiScripts: [] })).toEqual([])
    expect(declaredNames({ uiScripts: 'x' })).toEqual([])
  })
})

