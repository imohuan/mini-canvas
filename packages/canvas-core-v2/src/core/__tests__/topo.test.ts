import { describe, it, expect } from 'vitest'
import { topoSort } from '../topo'

const P = (name: string, deps?: string[]) => ({ name, deps })

describe('topoSort（吸收 v1 Kahn 拓扑）', () => {
  it('无依赖时按原顺序返回', () => {
    expect(topoSort([P('a'), P('b')])).toEqual(['a', 'b'])
  })

  it('依赖方排在依赖之后', () => {
    // b 依赖 a ⇒ a 先装
    expect(topoSort([P('b', ['a']), P('a')])).toEqual(['a', 'b'])
  })

  it('链式依赖正确排序 a→b→c', () => {
    expect(topoSort([P('c', ['b']), P('b', ['a']), P('a')])).toEqual(['a', 'b', 'c'])
  })

  it('重复名抛错', () => {
    expect(() => topoSort([P('a'), P('a')])).toThrow(/Duplicate plugin name/)
  })

  it('自依赖抛错', () => {
    expect(() => topoSort([P('a', ['a'])])).toThrow(/cannot depend on itself/)
  })

  it('缺失依赖抛错', () => {
    expect(() => topoSort([P('a', ['ghost'])])).toThrow(/which is not registered/)
  })

  it('循环依赖抛错且给可读路径', () => {
    expect(() => topoSort([P('a', ['b']), P('b', ['a'])])).toThrow(/Circular dependency.*a → b|b → a/)
  })

  it('三角环也检测到', () => {
    expect(() => topoSort([P('a', ['b']), P('b', ['c']), P('c', ['a'])])).toThrow(
      /Circular dependency/,
    )
  })
})
