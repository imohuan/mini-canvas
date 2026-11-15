/**
 * 分组收藏（.plumegroup）：用户口径 2026-11-15
 *   「分组节点可以收藏到资源里面……可视化节点拖出来只有一个节点，
 *     可是你的节点组拖出来是一整组的节点数据，添加的时候分类直接为节点组」。
 *
 * 这里钉住三件事：
 *   ① 打包只收**这一组的整棵子树**（组 + 后代 + 内部连线），不带外面的人和线；
 *   ② 还原只挪根、子节点保持相对偏移（否则整组会散开）；
 *   ③ 根名字跟着画布去重，子节点名字保持原样。
 */
import { describe, expect, it } from 'vitest'
import { buildGroupPack, hydrateGroupPackMedia, parseGroupPack, planGroupPlacement } from '../composables/groupPack'

const node = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}, parentId?: string) => ({
  id,
  type,
  position: { x, y },
  data: { label: id, ...extra },
  ...(parentId ? { parentId } : {}),
})

const nodes = [
  node('g1', 'group', 100, 200, { nodeType: 'group' }),
  node('img1', 'image', 40, 60, { imageUrl: '/a.png' }, 'g1'),
  node('txt1', 'text', 300, 60, { text: 'hi' }, 'g1'),
  node('nested', 'group', 20, 20, { nodeType: 'group' }, 'g1'),
  node('img2', 'image', 10, 10, { imageUrl: '/b.png' }, 'nested'),
  node('outside', 'image', 900, 900, { imageUrl: '/c.png' }),
]

const edges = [
  { source: 'img1', target: 'txt1' },
  { source: 'img1', target: 'outside' },
]

describe('分组包：打包', () => {
  it('★ 只收整棵子树（含嵌套组），不带组外节点', () => {
    const pack = buildGroupPack({ groupId: 'g1', nodes, edges })!
    expect(pack.nodes.map((n) => n.id).sort()).toEqual(['g1', 'img1', 'img2', 'nested', 'txt1'])
    expect(pack.nodes.some((n) => n.id === 'outside')).toBe(false)
  })

  it('★ 内部连线保留，跨出组的线丢掉（否则拖回来会悬空）', () => {
    const pack = buildGroupPack({ groupId: 'g1', nodes, edges })!
    expect(pack.edges).toEqual([{ source: 'img1', target: 'txt1' }])
  })

  it('名字取根的 label；不是分组 → 不打包', () => {
    expect(buildGroupPack({ groupId: 'g1', nodes, edges })!.name).toBe('g1')
    expect(buildGroupPack({ groupId: 'img1', nodes, edges })).toBeNull()
    expect(buildGroupPack({ groupId: 'missing', nodes, edges })).toBeNull()
  })

  it('data.nodeType=group 的节点也认作分组（渲染层包过壳的存量数据）', () => {
    const odd = [{ id: 'x', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'group' } }]
    expect(buildGroupPack({ groupId: 'x', nodes: odd, edges: [] })).not.toBeNull()
  })
})

describe('分组包：还原', () => {
  const pack = buildGroupPack({ groupId: 'g1', nodes, edges })!

  it('★ 只挪根到落点，子节点保持相对偏移（整组不散开）', () => {
    let seq = 0
    const plan = planGroupPlacement(pack, { origin: { x: 1000, y: 2000 }, allocateId: () => 'n' + ++seq })
    const byOld = new Map(pack.nodes.map((n, i) => [n.id, plan.nodes[i]!]))
    expect(byOld.get('g1')!.position).toEqual({ x: 1000, y: 2000 })
    expect(byOld.get('img1')!.position).toEqual({ x: 40, y: 60 })
  })

  it('★ 父子引用换成新 id（不能带着原画布的 id 走）', () => {
    let seq = 0
    const plan = planGroupPlacement(pack, { origin: { x: 0, y: 0 }, allocateId: () => 'n' + ++seq })
    const root = plan.nodes.find((n) => n.id === plan.rootId)!
    expect(root.type).toBe('group')
    for (const n of plan.nodes) {
      if (n.parentId) expect(plan.nodes.some((p) => p.id === n.parentId)).toBe(true)
    }
    expect(plan.edges.every((e) => plan.nodes.some((n) => n.id === e.source) && plan.nodes.some((n) => n.id === e.target))).toBe(true)
  })

  it('★ 父节点排在子节点前面（否则渲染层会刷「missing a parent」）', () => {
    let seq = 0
    const plan = planGroupPlacement(pack, { origin: { x: 0, y: 0 }, allocateId: () => 'n' + ++seq })
    const at = new Map(plan.nodes.map((n, i) => [n.id, i]))
    for (const n of plan.nodes) {
      if (!n.parentId) continue
      expect(at.get(n.parentId)!, '父节点必须更早出现').toBeLessThan(at.get(n.id)!)
    }
  })

  it('★ 根名字撞了画布上已有的 → 自动加序号；子节点名字原样保留', () => {
    let seq = 0
    const plan = planGroupPlacement(pack, {
      origin: { x: 0, y: 0 },
      allocateId: () => 'n' + ++seq,
      takenLabels: ['g1'],
    })
    const root = plan.nodes.find((n) => n.id === plan.rootId)!
    // 名字本身带序号（g1）→ 从那个号往上接着找（g 2），而不是叠成「g1 2」
    expect(root.data.label).toBe('g 2')
    expect(plan.nodes.find((n) => n.type === 'text')!.data.label).toBe('txt1')
  })
})

describe('分组包：结构校验与媒体补水', () => {
  it('乱码 / 版本不对 → 抛错（不静默建半个组）', () => {
    expect(() => parseGroupPack(null)).toThrow()
    expect(() => parseGroupPack({ format: 'other' })).toThrow()
    expect(() => parseGroupPack({ format: 'plume-group', version: 99, rootId: 'a', nodes: [] })).toThrow()
  })

  it('联网取不到时盘里的包仍可解析（收藏→拖回不依赖后台额外接口）', () => {
    const pack = buildGroupPack({ groupId: 'g1', nodes, edges })!
    const back = parseGroupPack(JSON.parse(JSON.stringify(pack)))
    expect(back.nodes.length).toBe(pack.nodes.length)
    expect(back.rootId).toBe('g1')
  })

  it('★ resourceId 能换到本机地址时补进 xxxUrl；换不到就保持原样', async () => {
    const pack = {
      format: 'plume-group' as const,
      version: 1 as const,
      name: '组',
      rootId: 'g',
      nodes: [
        { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { nodeType: 'group' } },
        { id: 'v', type: 'video', position: { x: 1, y: 1 }, data: { resourceId: 'r1', videoUrl: '/old.mp4' }, parentId: 'g' },
        { id: 'a', type: 'audio', position: { x: 2, y: 2 }, data: { resourceId: 'r2' }, parentId: 'g' },
      ],
      edges: [],
    }
    const got = await hydrateGroupPackMedia(pack, async (id) => (id === 'r1' ? '/new.mp4' : undefined))
    expect(got.nodes[1]!.data.videoUrl).toBe('/new.mp4')
    expect(got.nodes[2]!.data.audioUrl).toBeUndefined()
  })
})
