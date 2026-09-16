/**
 * graphDiff 单测（纯函数）。
 *
 * 这块决定「网页端保存时提交什么」。做错的方向有两个，都比「少存一次」严重得多：
 *   - 该报的改动没报 → 用户改了东西却没存上去；
 *   - 不该报的报了 → 把另一个写方（AI）的改动当成自己的删掉/覆盖掉。
 * 所以用例集中在「哪些算变了、哪些不算」。
 */
import { describe, it, expect } from 'vitest'
import { diffGraph, isEmptyOps } from '../graphDiff'

const node = (id: string, x = 0, data: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  position: { x, y: 0 },
  data,
})

describe('diffGraph —— 认得出该报的改动', () => {
  it('新增的节点进 add', () => {
    const ops = diffGraph([node('a')], [node('a'), node('b')])
    expect(ops.add.map((n: any) => n.id)).toEqual(['b'])
    expect(ops.delete).toEqual([])
    expect(ops.update).toEqual([])
  })

  it('改过的节点进 update（整节点提交，服务端做浅合并）', () => {
    const ops = diffGraph([node('a', 0, { text: 'old' })], [node('a', 0, { text: 'new' })])
    expect(ops.update.map((n: any) => n.id)).toEqual(['a'])
  })

  it('删掉的节点进 delete', () => {
    const ops = diffGraph([node('a'), node('b')], [node('b')])
    expect(ops.delete).toEqual(['a'])
  })

  it('位置改了也算改', () => {
    const ops = diffGraph([node('a', 0)], [node('a', 42)])
    expect(ops.update.map((n: any) => n.id)).toEqual(['a'])
  })
})

describe('diffGraph —— 不该报的一个都别报（报错了会盖掉别人的改动）', () => {
  it('一模一样 → 三条全空（不发请求）', () => {
    const g = [node('a', 1, { k: 'v' })]
    const ops = diffGraph(g, JSON.parse(JSON.stringify(g)))
    expect(isEmptyOps(ops)).toBe(true)
  })

  it('对象 key 顺序不同不算改（否则每次保存都会误报一轮）', () => {
    const before = [{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { p: 1, q: 2 } }]
    const after = [{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { q: 2, p: 1 } }]
    expect(isEmptyOps(diffGraph(before, after))).toBe(true)
  })

  it('第一次提交（没有基准）→ 全当新增，绝不产生删除', () => {
    const ops = diffGraph(undefined, [node('a'), node('b')])
    expect(ops.add.length).toBe(2)
    expect(ops.delete).toEqual([])
  })

  it('没有 id 的条目被跳过（不猜，交给服务端校验）', () => {
    const ops = diffGraph([], [{ type: 'text' }, node('ok')])
    expect(ops.add.map((n: any) => n.id)).toEqual(['ok'])
  })

  it('mine 不是数组（脏数据）→ 什么都不做，而不是把画布清空', () => {
    expect(isEmptyOps(diffGraph([node('a')], null))).toBe(true)
  })
})

describe('diffGraph —— 与实时同步配合时的关键性质', () => {
  /**
   * AI 加的节点会被实时通道合进本地。它既然已经在「我这份」里，
   * 只要基准里也有它，就不会被算成「我删了它」。这条是防「AI 的改动被画布保存抹掉」的核心。
   */
  it('AI 加进来、并被记进基准的节点，保存时不会出现在 delete 里', () => {
    const base = [node('a'), node('ai-1')]
    const mine = [node('a'), node('ai-1'), node('local-new')]
    const ops = diffGraph(base, mine)
    expect(ops.delete).toEqual([])
    expect(ops.add.map((n: any) => n.id)).toEqual(['local-new'])
  })
})

