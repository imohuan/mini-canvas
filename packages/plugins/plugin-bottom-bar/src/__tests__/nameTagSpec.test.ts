/**
 * 「标记」按钮的识别规则（用户 2026-10-28 定案）：正文写 `@名称`。
 *
 * - 名称命中**已连线**素材 → 已绑定标签 `ref-node:<id>`（带真实类型）；
 * - 没命中 → 待绑定标签 `ref-name:<名>`（统一资源图标，拖节点进来即完成添加）；
 * - 名称含空格、中文标点都要能正确切段（AI 写的提示词经常带标点）。
 */
import { describe, expect, it } from 'vitest'
import { bottomBarTagSpecFor, type UpstreamMaterial } from '../panelSource'

const mat = (id: string, name: string, kind: UpstreamMaterial['kind'] = 'image'): UpstreamMaterial => ({
  id,
  name,
  kind,
  refName: name,
  ...(kind === 'image' ? { url: 'https://x/' + id + '.png' } : {}),
})

const spec = (materials: UpstreamMaterial[]) => bottomBarTagSpecFor(() => materials)

describe('按名称识别 @ 标签', () => {
  it('命中已连线素材 → ref-node:<id>，名字用节点名', () => {
    const hits = spec([mat('n1', '天空之城')]).scan('把 @天空之城 换成夜景')
    expect(hits).toHaveLength(1)
    expect(hits[0].item.id).toBe('ref-node:n1')
    expect(hits[0].item.name).toBe('天空之城')
    expect(hits[0].item.chipKind).toBe('image')
  })

  it('没命中 → ref-name:<名>（待绑定，不猜类型）', () => {
    const hits = spec([mat('n1', '天空之城')]).scan('用 @雨声 当背景音')
    expect(hits[0].item.id).toBe('ref-name:雨声')
    expect(hits[0].item.chipKind).toBeUndefined()
  })

  it('名称含空格：最长优先（「天空之城」不会被「天空」截走）', () => {
    const hits = spec([mat('n1', '天空'), mat('n2', '天空之城')]).scan('看 @天空之城')
    expect(hits[0].item.id).toBe('ref-node:n2')
  })

  it('中文标点处截断（AI 写的提示词常见）', () => {
    const hits = spec([mat('n1', '天空之城')]).scan('参考 @天空之城，画成夜景。')
    expect(hits).toHaveLength(1)
    expect(hits[0].item.name).toBe('天空之城')
    // 只替换 @名称 这一段，后面的标点留作正文
    expect(hits[0].to - hits[0].from).toBe(1 + '天空之城'.length)
  })

  it('一段文字里多个 @ 都能扫出来', () => {
    const hits = spec([mat('n1', '甲'), mat('n2', '乙', 'audio')]).scan('@甲 和 @乙 放一起')
    expect(hits.map((h) => h.item.id)).toEqual(['ref-node:n1', 'ref-node:n2'])
  })

  it('没有 @ → 不产生标签', () => {
    expect(spec([mat('n1', '天空之城')]).scan('随便写点东西')).toHaveLength(0)
  })

  it('每次 scan 现取素材（挂载后才连进来的节点也能 @）', () => {
    let materials: UpstreamMaterial[] = []
    const live = bottomBarTagSpecFor(() => materials)
    expect(live.scan('@天空之城')[0].item.id).toBe('ref-name:天空之城')
    materials = [mat('n1', '天空之城')]
    expect(live.scan('@天空之城')[0].item.id).toBe('ref-node:n1')
  })
})
