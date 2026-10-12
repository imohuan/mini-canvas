/**
 * panelSource 的「素材顺序」契约（零 Vue / 零 DOM，纯函数）。
 *
 * 用户口径（2026-10-12）：「参考图的顺序是如何决定的？我看了好像是根据连接的先后顺序
 * 来做的。我希望这个顺序可以进行拖拽改变。」
 *
 * 语义定案：
 * - 没给顺序（老画布 / 从没拖过）→ **连线先后**（既有行为，一个字不改）；
 * - 给了 `data.refOrder`（用户拖过的节点 id 序列）→ 按它排；没列到的垫在最后、
 *   之间仍保持连线先后（稳定排序，不会把新连进来的素材插到中间乱跳）；
 * - **引用名（图片1 / 图片2）跟着最终顺序重新编号** —— 卡片角标、@ 引用名、提示词里
 *   的 token 三处永远指同一张图（顺序变了编号不变会直接指错图）。
 */
import { describe, expect, it } from 'vitest'
import { collectUpstreamMaterials, materialCards, nextRefOrder, previewListFor } from '../panelSource'

/** 三个图片节点（连谁进来只看边；这里给最小可判定形状） */
const nodes: Record<string, { type: string; data: Record<string, unknown> }> = {
  a: { type: 'image', data: { imageUrl: 'https://x/a.png' } },
  b: { type: 'image', data: { imageUrl: 'https://x/b.png' } },
  c: { type: 'image', data: { imageUrl: 'https://x/c.png' } },
}
const getNode = (id: string) => nodes[id]

/** 连线顺序：a → b → c（都连进 target） */
const edges = [
  { source: 'a', target: 't' },
  { source: 'b', target: 't' },
  { source: 'c', target: 't' },
]

describe('collectUpstreamMaterials：素材顺序', () => {
  it('没给顺序 → 连线先后（既有行为不变）', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode)
    expect(m.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(m.map((x) => x.refName)).toEqual(['图片1', '图片2', '图片3'])
  })

  it('给了顺序 → 按顺序排，且引用名跟着重编号（卡片角标/@ 名/token 三处一致）', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode, ['c', 'a', 'b'])
    expect(m.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(m.map((x) => x.refName)).toEqual(['图片1', '图片2', '图片3'])
  })

  it('顺序里没列到的（新连进来的）垫在最后，且它们之间保持连线先后', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode, ['c'])
    expect(m.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })

  it('顺序里有已经断开的死 id → 忽略它，不影响其余排序', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode, ['gone', 'b'])
    expect(m.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('重复 id 只认第一次（同一条边重复连不产生第二张卡）', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode, ['b', 'b'])
    expect(m.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('材质卡渲染顺序 = 素材顺序（角标 1..N 跟着走）', () => {
    const m = collectUpstreamMaterials(edges, 't', getNode, ['b', 'c', 'a'])
    expect(materialCards(m).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('nextRefOrder：拖拽后该写什么（写盘与否由调用方决定）', () => {
  const cardsOf = (ids: string[]) => ids.map((id) => ({ id }))

  it('拖拽库给了新顺序 → 返回它（这是唯一正确的来源，不能读派生 computed）', () => {
    expect(nextRefOrder(['a', 'b', 'c'], cardsOf(['a', 'b', 'c']), cardsOf(['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })

  it('顺序没变 → null（不写盘、不进撤销栈）', () => {
    expect(nextRefOrder(['a', 'b', 'c'], cardsOf(['a', 'b', 'c']), cardsOf(['a', 'b', 'c']))).toBeNull()
  })

  it('第一次拖（从没存过顺序）→ 也写，把用户想要的顺序定下来', () => {
    expect(nextRefOrder([], cardsOf(['a', 'b', 'c']), cardsOf(['b', 'a', 'c']))).toEqual(['b', 'a', 'c'])
  })

  it('库里没给数组 / 长度对不上（异常）→ 退回当前渲染那份，不写坏', () => {
    expect(nextRefOrder([], cardsOf(['a', 'b', 'c']), undefined)).toEqual(['a', 'b', 'c'])
    expect(nextRefOrder([], cardsOf(['a', 'b', 'c']), cardsOf(['a']))).toEqual(['a', 'b', 'c'])
  })

  it('没有素材 → null（不产出一个空 refOrder）', () => {
    expect(nextRefOrder([], [], [])).toBeNull()
  })
})

/**
 * previewListFor：点开一张素材卡时，交给全屏预览（MediaViewer）的 list / index。
 *
 * 用户口径（2026-10-12）：「我有多个图片，需要按左右快捷键进行切换。
 * 我这个组件本身是支持的（useUiComponent("mediaViewer")）」——
 * MediaViewer 本来就认 list + index，此前底栏只传单张，所以切不了。
 */
describe('previewListFor：多张同类素材交给预览轮播', () => {
  const card = (id: string, kind: 'image' | 'video' | 'audio' | 'text', url?: string) => ({
    id,
    kind,
    name: id,
    url,
    value: kind === 'text' ? '正文' : undefined,
    isText: kind === 'text',
  })

  it('三张图点第二张 → list 是三个地址，index=1（键上就有 ← / → 切换）', () => {
    const cards = [card('a', 'image', 'https://x/a.png'), card('b', 'image', 'https://x/b.png'), card('c', 'image', 'https://x/c.png')]
    expect(previewListFor(cards, cards[1])).toEqual({
      list: ['https://x/a.png', 'https://x/b.png', 'https://x/c.png'],
      index: 1,
      ids: ['a', 'b', 'c'],
      names: ['a', 'b', 'c'],
    })
  })

  it('只圈同类：混着视频/文本时，list 只收同类的图', () => {
    const cards = [card('a', 'image', 'a.png'), card('v', 'video', 'v.mp4'), card('b', 'image', 'b.png'), card('t', 'text')]
    expect(previewListFor(cards, cards[0])).toEqual({
      list: ['a.png', 'b.png'],
      index: 0,
      ids: ['a', 'b'],
      names: ['a', 'b'],
    })
  })

  it('只有一张（或一张都没有）→ null（单张不出翻页按钮与页码）', () => {
    const one = [card('a', 'image', 'a.png'), card('t', 'text')]
    expect(previewListFor(one, one[0])).toBeNull()
    expect(previewListFor([], card('a', 'image', 'a.png'))).toBeNull()
  })

  it('文本卡点开 → null（文本没有地址，不能进轮播）', () => {
    const cards = [card('a', 'image', 'a.png'), card('b', 'image', 'b.png'), card('t', 'text')]
    expect(previewListFor(cards, cards[2])).toBeNull()
  })
})
