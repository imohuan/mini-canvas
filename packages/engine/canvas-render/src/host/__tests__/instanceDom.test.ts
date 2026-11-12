/**
 * 双画布宿主：节点 DOM 查询必须限定在本实例根内。
 *
 * 两个画布的节点 id 可以相同（同一个文档在两块画布上打开），如果查询退回
 * document.querySelector，第一个命中的永远是先挂载那块画布的 DOM，拖拽/测量就会串线。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { queryNodeElIn } from '../instanceDom'

function fakeRoot(nodeId: string) {
  const own = { textContent: `mine:${nodeId}` } as unknown as HTMLElement
  const root = {
    queries: [] as string[],
    querySelector(selector: string) {
      this.queries.push(selector)
      return selector.includes(`data-id="${nodeId}"`) ? own : null
    },
  }
  return { root, own }
}

describe('queryNodeElIn：实例级节点 DOM 查询', () => {
  it('两个画布各查自己的节点，不交叉命中', () => {
    const left = fakeRoot('shared-node')
    const right = fakeRoot('shared-node')

    expect(queryNodeElIn(left.root as unknown as ParentNode, 'shared-node')).toBe(left.own)
    expect(queryNodeElIn(right.root as unknown as ParentNode, 'shared-node')).toBe(right.own)
    // 左画布只在自己的根上查过一次，右画布同样
    expect(left.root.queries).toHaveLength(1)
    expect(right.root.queries).toHaveLength(1)
  })

  it('本实例没有该节点时返回 null，不借用别的画布', () => {
    const left = fakeRoot('only-right')
    expect(queryNodeElIn(left.root as unknown as ParentNode, 'only-left')).toBeNull()
  })

  it('根未挂载（null/undefined）返回 null', () => {
    expect(queryNodeElIn(null, 'n1')).toBeNull()
    expect(queryNodeElIn(undefined, 'n1')).toBeNull()
  })

  it('CanvasSurface 的节点查询统一走实例根，没有退回 document.querySelector', () => {
    const src = readFileSync(new URL('../CanvasSurface.vue', import.meta.url), 'utf-8')
    // 注释里会提到「替代 document.querySelector」，这里只看真正的代码
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('document.querySelector')
    expect(src.match(/queryNodeElIn\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
})
