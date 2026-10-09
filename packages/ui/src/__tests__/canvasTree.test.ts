/**
 * 左侧「画布」树 —— 由**真实画布数据**构建（纯函数，node 可单测）。
 *
 * 用户口径：左侧文件夹/节点的名字全部来自节点本身；文件夹套文件夹 = 分组；
 * 点击节点要让它在画布上居中显示（那是 ui.ts 的 locateNode，本文件只管"树长什么样"）。
 */
import { describe, it, expect } from 'vitest'
import { buildCanvasTree, nodeDisplayName, nodeThumbUrl, nodeVideoUrl, filterTree, canvasTreeBlocks } from '../composables/canvasTree'
import type { CanvasTreeNodeRow } from '../composables/canvasTree'
import type { TreeNode } from '../composables/ui'

/**
 * 视频节点的缩略图（用户报 2026-10-08 的"图 1 裂图"）：
 * thumb 以前回落到了 videoUrl —— mp4 地址塞进 <img> 必然裂图，也没有任何视频标识。
 * 修法：thumb 只认真图片（海报图）；视频播放地址单独走 nodeVideoUrl（抽屉用 <video> 显示首帧）。
 */
describe('nodeThumbUrl / nodeVideoUrl —— 视频节点不再把 mp4 当图片地址', () => {
  it('视频节点：有海报图（posterUrl / thumbUrl）时用海报当缩略图', () => {
    expect(nodeThumbUrl({ id: 'v', type: 'video', data: { posterUrl: '/p.png', videoUrl: '/v.mp4' } })).toBe('/p.png')
    expect(nodeThumbUrl({ id: 'v', type: 'video', data: { thumbUrl: '/t.png' } })).toBe('/t.png')
  })

  it('视频节点只有 videoUrl：缩略图拿不到（undefined），播放地址走 nodeVideoUrl', () => {
    const n = { id: 'v', type: 'video', data: { videoUrl: '/v.mp4' } }
    expect(nodeThumbUrl(n)).toBe(undefined)
    expect(nodeVideoUrl(n)).toBe('/v.mp4')
  })

  it('nodeVideoUrl：只有视频节点给值；图片/文本/分组不给', () => {
    expect(nodeVideoUrl({ id: 'i', type: 'image', data: { imageUrl: '/i.png', videoUrl: '/x.mp4' } })).toBe(undefined)
    expect(nodeVideoUrl({ id: 't', type: 'text', data: {} })).toBe(undefined)
    expect(nodeVideoUrl({ id: 'g', type: 'group', data: {} })).toBe(undefined)
    // 渲染层把视频包成 custom 时按 data.nodeType 认
    expect(nodeVideoUrl({ id: 'v', type: 'custom', data: { nodeType: 'video', videoUrl: '/v.mp4' } })).toBe('/v.mp4')
  })

  it('buildCanvasTree：无海报的视频节点带 video 字段、不带 thumb（裂图根因的回归守卫）', () => {
    const tree = buildCanvasTree([{ id: 'v', type: 'video', position: { x: 0, y: 0 }, data: { videoUrl: '/v.mp4', label: '视频 1' } }])
    expect(tree[0].thumb).toBe(undefined)
    expect(tree[0].video).toBe('/v.mp4')
  })
})

describe('buildCanvasTree —— 按 parentId 组织成分组树', () => {
  it('有 parentId 的节点挂到父组下，没父的当根', () => {
    const tree = buildCanvasTree([
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { title: '分组 A' } },
      { id: 'a', type: 'image', parentId: 'g', position: { x: 1, y: 2 }, data: { imageName: '甲.png' } },
      { id: 'b', type: 'audio', position: { x: 3, y: 4 }, data: { audioName: '乙.mp3' } },
    ])
    expect(tree.map((n) => n.id)).toEqual(['g', 'b'])
    expect(tree[0].children?.map((n) => n.id)).toEqual(['a'])
  })

  it('父节点不存在（被删/孤儿）时，子节点升为根 —— 不丢节点', () => {
    const tree = buildCanvasTree([
      { id: 'a', type: 'image', parentId: '不存在', position: { x: 0, y: 0 }, data: {} },
    ])
    expect(tree.map((n) => n.id)).toEqual(['a'])
  })

  it('名字只认 data.label（节点自己的名字）', () => {
    expect(nodeDisplayName({ id: '1', type: 'image', data: { label: '图片 1' } })).toBe('图片 1')
    expect(nodeDisplayName({ id: '2', type: 'text', data: { label: '文本 3' } })).toBe('文本 3')
    // 没有 label 才回落「<类型> 节点」
    expect(nodeDisplayName({ id: '4', type: 'image', data: {} })).toBe('图片')
  })

  it('名字后面不带「节点」后缀，也不拿节点文本当名字（用户口径）', () => {
    expect(nodeDisplayName({ id: 'g', type: 'group', data: { nodeType: 'group' } })).toBe('分组')
    expect(nodeDisplayName({ id: 't', type: 'text', data: { text: '一段提示词' } })).toBe('文本')
    // 有 label（用户改过名）时优先用它，且只取首行
    expect(nodeDisplayName({ id: 'x', type: 'text', data: { label: '我的标题\n第二行', text: '正文' } })).toBe('我的标题')
    // 图片有 imageName 时用它（与画布上显示的一致）
    expect(nodeDisplayName({ id: 'i', type: 'image', data: { imageName: 'a.png' } })).toBe('a.png')
  })

  it('图片读 imageName（跟随画布显示），文本只回落到类型名', () => {
    expect(nodeDisplayName({ id: '1', type: 'image', data: { imageName: 'x.png' } })).toBe('x.png')
    expect(nodeDisplayName({ id: '2', type: 'text', data: { text: '一段提示词' } })).toBe('文本')
  })

  it('携带画布坐标（点击居中要用）', () => {
    const tree = buildCanvasTree([{ id: 'a', type: 'image', position: { x: 12, y: 34 }, data: {} }])
    expect(tree[0].x).toBe(12)
    expect(tree[0].y).toBe(34)
  })

  it('分组名读 data.label（外壳标题条改的就是它）', () => {
    const tree = buildCanvasTree([
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { label: '发的发大', nodeType: 'group' } },
    ])
    expect(tree[0].name).toBe('发的发大')
    expect(tree[0].icon).toBe('group')
  })

  it('类型优先 data.nodeType（渲染层可能把它包成 custom）', () => {
    const tree = buildCanvasTree([{ id: 'v', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'video', label: '视频 1' } }])
    expect(tree[0].name).toBe('视频 1')
    expect(tree[0].icon).toBe('video')
  })
})

/**
 * 抽屉「画布」树的行块拍平 —— 用户报的「嵌套分组只显示第一层，第二层没实现」。
 *
 * 老模板里是写死的两层（根分组 + 它的一层孩子）：孩子自己还是分组时，整棵子树不显示。
 * 现在拍成有序块序列，模板一个循环画完，层数不设限。
 */
describe('canvasTreeBlocks —— 任意层嵌套的分组树拍平成行块', () => {

/**
 * 分组排在普通节点前面（用户口径 2026-10-08）：「我希望你的这个分组可以显示在最上面，
 * 下面再显示一些普通资源。这种分组类似于文件夹，统一显示在最上面」。
 *
 * 为什么在数据层排：树的**每一层**都要这个效果（顶层分组提前，分组里的子分组同样提前），
 * buildCanvasTree 递归处理 kids，一次覆盖所有层。组内/普通节点之间的相对顺序保持不变
 * （画布上的原始顺序才是用户能感知、能靠拖拽调整的那个）。
 */
describe('buildCanvasTree —— 分组统一排在普通节点前面', () => {
  const img = (id: string, name: string): { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> } =>
    ({ id, type: 'image', position: { x: 0, y: 0 }, data: { label: name } })
  const grp = (id: string, name: string): { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> } =>
    ({ id, type: 'group', position: { x: 0, y: 0 }, data: { label: name, nodeType: 'group' } })

  it('顶层：分组夹在图片中间时，分组全部提到前面（用户截图里的排布）', () => {
    const tree = buildCanvasTree([
      img('a', '图片 6'),
      img('b', '图片 7'),
      grp('g1', '分组 1'),
      img('c', '裁剪'),
      grp('g2', '分组 2'),
      img('d', '图片 18'),
    ])
    expect(tree.map((n) => n.id)).toEqual(['g1', 'g2', 'a', 'b', 'c', 'd'])
  })

  it('组内也照此排：子分组提到同层普通节点前面', () => {
    const tree = buildCanvasTree([
      grp('outer', '外层组'),
      { id: 'i1', type: 'image', parentId: 'outer', position: { x: 0, y: 0 }, data: { label: '图片 3' } },
      { id: 'inner', type: 'group', parentId: 'outer', position: { x: 0, y: 0 }, data: { label: '分组 2', nodeType: 'group' } },
      { id: 'i2', type: 'image', parentId: 'outer', position: { x: 0, y: 0 }, data: { label: '图片 4' } },
    ])
    expect(tree.map((n) => n.id)).toEqual(['outer'])
    // 子分组在前，两张图保持原相对顺序在后
    expect(tree[0].children?.map((n) => n.id)).toEqual(['inner', 'i1', 'i2'])
  })

  it('普通节点之间 / 分组之间的相对顺序不变（稳定排序，不引入第二套键）', () => {
    const tree = buildCanvasTree([img('a', 'A'), grp('g2', 'G2'), img('b', 'B'), grp('g1', 'G1'), img('c', 'C')])
    // 两个分组按画布里的先后（g2 先于 g1）；三张图保持 a、b、c
    expect(tree.map((n) => n.id)).toEqual(['g2', 'g1', 'a', 'b', 'c'])
  })

  it('本来就已经分组在前时顺序原样（不折腾）', () => {
    const tree = buildCanvasTree([grp('g', 'G'), img('a', 'A'), img('b', 'B')])
    expect(tree.map((n) => n.id)).toEqual(['g', 'a', 'b'])
  })

  it('渲染层把分组包成 custom 时也认（data.nodeType 优先）', () => {
    const tree = buildCanvasTree([
      img('a', 'A'),
      { id: 'g', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'group', label: '分组 X' } },
    ])
    expect(tree.map((n) => n.id)).toEqual(['g', 'a'])
  })
})
  const leaf = (id: string, name: string): TreeNode => ({ id, name, meta: '', icon: 'image' })
  const group = (id: string, name: string, children: TreeNode[]): TreeNode => ({ id, name, meta: '', icon: 'group', children })

  it('两层嵌套：第二层分组出分组头（老实现整棵子树被丢掉）', () => {
    const tree = [
      group('g1', '分组 1', [
        leaf('a', '图片 1'),
        group('g2', '分组 2', [leaf('b', '图片 2')]),
      ]),
    ]
    const blocks = canvasTreeBlocks(tree, () => false)
    expect(blocks.map((b) => b.kind)).toEqual(['group', 'run', 'group', 'run'])
    expect(blocks[0]).toMatchObject({ kind: 'group', id: 'g1', depth: 0 })
    expect(blocks[1]).toMatchObject({ kind: 'run', depth: 1 })
    expect((blocks[1] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(['a'])
    // 第二层分组头（用户报的"第二层"）
    expect(blocks[2]).toMatchObject({ kind: 'group', id: 'g2', depth: 1 })
    expect((blocks[3] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(['b'])
  })

  it('三层嵌套照样拍平（深度逐层 +1）', () => {
    const tree = [group('g1', '一', [group('g2', '二', [group('g3', '三', [leaf('x', '叶子')])])])]
    const blocks = canvasTreeBlocks(tree, () => false)
    expect(blocks.filter((b) => b.kind === 'group').map((b) => (b as { depth: number }).depth)).toEqual([0, 1, 2])
    expect((blocks.at(-1) as { depth: number }).depth).toBe(3)
  })

  it('折叠的分组只出分组头，子块一个不留；它的兄弟照常出', () => {
    const tree = [
      group('g1', '折叠的', [leaf('a', '图片 1')]),
      group('g2', '展开的', [leaf('b', '图片 2')]),
    ]
    const blocks = canvasTreeBlocks(tree, (id) => id === 'g1')
    expect(blocks.map((b) => b.key)).toEqual(['group:g1', 'group:g2', 'run:1:b'])
  })

  it('连续同层节点并成一段（宫格模式一段 = 一个三列网格）', () => {
    const tree = [leaf('a', 'A'), leaf('b', 'B'), leaf('c', 'C'), group('g', '分组', [leaf('d', 'D')]), leaf('e', 'E')]
    const blocks = canvasTreeBlocks(tree, () => false)
    expect(blocks.map((b) => b.kind)).toEqual(['run', 'group', 'run', 'run'])
    expect((blocks[0] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    // 分组前那段被隔断（分组头是整行，不能和上一段挤同一行）
    expect((blocks[3] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id)).toEqual(['e'])
  })

  it('段的 depth 跟随所在层；缩略图/视频字段原样带出（抽屉要画 <video>）', () => {
    const tree = [group('g', '分组', [{ id: 'v', name: '视频 1', meta: '', icon: 'video', video: '/v.mp4', thumb: '/p.png' }])]
    const blocks = canvasTreeBlocks(tree, () => false)
    const run = blocks[1] as { depth: number; nodes: CanvasTreeNodeRow[] }
    expect(run.depth).toBe(1)
    expect(run.nodes[0]).toMatchObject({ id: 'v', icon: 'video', video: '/v.mp4', thumb: '/p.png' })
  })

  it('空树 / 全是顶层叶子：不产空块', () => {
    expect(canvasTreeBlocks([], () => false)).toEqual([])
    const blocks = canvasTreeBlocks([leaf('a', 'A')], () => false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'run', depth: 0 })
  })
})

describe('filterTree —— 搜索 + 类型过滤（下拉真正生效）', () => {
  const tree: TreeNode[] = [
    { id: 'g', name: '分组 A', meta: '', icon: 'group', children: [
      { id: 'i1', name: '图片甲', meta: '', icon: 'image' },
      { id: 't1', name: '文本乙', meta: '', icon: 'text' },
    ] },
    { id: 'v1', name: '视频丙', meta: '', icon: 'video' },
  ]

  it('全部：不过滤', () => {
    expect(filterTree(tree, { type: '全部' }).nodes.map((n) => n.id)).toEqual(['g', 'v1'])
  })

  it('类型过滤：图片 → 只留图片（分组因含图片子节点而保留）', () => {
    const { nodes } = filterTree(tree, { type: '图片' })
    expect(nodes.map((n) => n.id)).toEqual(['g'])
    expect(nodes[0].children?.map((n) => n.id)).toEqual(['i1'])
  })

  it('类型过滤：视频 → 只剩视频丙', () => {
    expect(filterTree(tree, { type: '视频' }).nodes.map((n) => n.id)).toEqual(['v1'])
  })

  it('类型过滤：音频 → 只留音频（音频不该被当成图片）', () => {
    const t: TreeNode[] = [
      { id: 'i', name: '图', meta: '', icon: 'image' },
      { id: 'a', name: '音', meta: '', icon: 'audio' },
    ]
    expect(filterTree(t, { type: '音频' }).nodes.map((n) => n.id)).toEqual(['a'])
    expect(filterTree(t, { type: '图片' }).nodes.map((n) => n.id)).toEqual(['i'])
  })

  it('类型过滤：分组 → 只留分组', () => {
    expect(filterTree(tree, { type: '分组' }).nodes.map((n) => n.id)).toEqual(['g'])
  })

  it('文本搜索 + 类型过滤同时生效', () => {
    const { nodes } = filterTree(tree, { query: '甲', type: '图片' })
    expect(nodes.map((n) => n.id)).toEqual(['g'])
    expect(nodes[0].children?.map((n) => n.id)).toEqual(['i1'])
    // 类型不符时（文本乙 不是图片）搜到也不留
    expect(filterTree(tree, { query: '乙', type: '图片' }).nodes).toEqual([])
  })

  it('命中的分组会被标记展开', () => {
    expect(filterTree(tree, { type: '图片' }).expandIds).toContain('g')
  })
})
