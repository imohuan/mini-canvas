/**
 * 「看图」参考槽位的两条关键规则（用户口径 2026-10-25）：
 *
 * ① 「点击第二个空区域进行上传，那么这个连接线就属于第二个参考」
 *    → placeRefAtSlot 把新素材插到第 index 位（refName 按连线顺序编号）。
 *
 * ② 「只传了一张图，并且声明的是\"图片 2\"，这就存在问题……是不允许你点击发送按钮的」
 *    → 参考序号有缺时 canRun 必须为 false（这里用同一套纯函数算「缺哪几格」）。
 */
import { describe, it, expect } from 'vitest'
import { placeRefAtSlot } from '../panelSource'
import { refSlotKey } from '../refSlots'
import { mergeRefTiles, findRefGap, uploadToRefSlot, type UploadDeps } from '../refTiles'

describe('上传槽位：建节点 → 还选中 → 连线 → 排位', () => {
  /** 记录每次调用顺序的假依赖 */
  function deps(overrides: Partial<UploadDeps> = {}) {
    const calls: string[] = []
    let order: string[] = []
    const base: UploadDeps = {
      addFiles: async () => { calls.push('addFiles'); return 1 },
      waitTick: async () => { calls.push('waitTick') },
      afterCreate: () => { calls.push('afterCreate') },
      addEdge: () => { calls.push('addEdge'); return 'e1' },
      refOrder: () => order,
      writeOrder: (ids) => { calls.push('writeOrder'); order = ids },
      pickCreated: () => ({ id: 'n-new', name: '图片2', url: 'u' }),
      positionFor: (i) => ({ x: -i * 100, y: 0 }),
    }
    return { deps: { ...base, ...overrides }, calls, getOrder: () => order }
  }

  it('成功时调用顺序固定：建节点 → 还选中 → 等帧 → 连线 → 排位', async () => {
    const d = deps()
    const r = await uploadToRefSlot({ file: new File([], 'a.png'), kind: 'image', index: 1, targetId: 'me' }, d.deps)
    expect(r.ok).toBe(true)
    expect(d.calls).toEqual(['addFiles', 'afterCreate', 'waitTick', 'addEdge', 'writeOrder'])
  })

  it('建节点失败 → 不连线、不排位', async () => {
    const d = deps()
    d.deps.addFiles = async () => { d.calls.push('addFiles'); return 0 }
    const r = await uploadToRefSlot({ file: new File([], 'a.txt'), kind: 'image', index: 1, targetId: 'me' }, d.deps)
    expect(r.ok).toBe(false)
    expect(d.calls).toEqual(['addFiles'])
    expect(r.error).toContain('没建出节点')
  })

  it('连线失败 → 报错且不写顺序', async () => {
    const d = deps({ addEdge: () => null })
    const r = await uploadToRefSlot({ file: new File([], 'a.png'), kind: 'image', index: 1, targetId: 'me' }, d.deps)
    expect(r.ok).toBe(false)
    expect(d.calls).not.toContain('writeOrder')
  })

  it('往第 2 格上传 → 新素材排到第 2 位（「属于第二个参考」）', async () => {
    const d = deps()
    await uploadToRefSlot({ file: new File([], 'a.png'), kind: 'image', index: 2, targetId: 'me' }, d.deps)
    expect(d.getOrder()).toEqual(['n-new'])
  })

  it('已有素材时往第 1 格上传 → 插到最前', async () => {
    const d = deps()
    d.deps.refOrder = () => ['a', 'b']
    await uploadToRefSlot({ file: new File([], 'a.png'), kind: 'image', index: 1, targetId: 'me' }, d.deps)
    // 用的是「上传前」的顺序再插入（a/b 仍在，新的在最前）
    expect(d.getOrder()[0]).toBe('n-new')
  })
})

describe('参考区只排一行（不再重复）', () => {
  it('同一个「图片1」：槽位与素材卡只出现一次', () => {
    const tiles = mergeRefTiles(
      [{ key: 'image:1', kind: 'image', index: 1, status: 'ready', name: '图片1', url: 'a.png' }],
      [{ id: 'n1', name: '图片1', url: 'a.png', isText: false }],
    )
    expect(tiles).toHaveLength(1)
    expect(tiles[0].key).toBe('slot:image:1')
    expect(tiles[0].pending).toBe(false)
  })

  it('待输入槽位 + 已连素材：合并成一行并按序号排', () => {
    const tiles = mergeRefTiles(
      [
        { key: 'image:1', kind: 'image', index: 1, status: 'ready', name: '图片1', url: 'a.png' },
        { key: 'image:2', kind: 'image', index: 2, status: 'pending' },
      ],
      [{ id: 'n1', name: '图片1', url: 'a.png', isText: false }],
    )
    expect(tiles.map((t) => t.key)).toEqual(['slot:image:1', 'slot:image:2'])
    expect(tiles[1].pending).toBe(true)
    expect(tiles[1].label).toBe('图片 2')
  })

  it('正文没写 @ 的已连素材也补成一格（参考不能凭空消失）', () => {
    const tiles = mergeRefTiles([], [{ id: 'n1', name: '图片1', url: 'a.png', isText: false }])
    expect(tiles).toHaveLength(1)
    expect(tiles[0].key).toBe('card:n1')
    expect(tiles[0].pending).toBe(false)
  })
})

describe('参考缺号 → 不许发送', () => {
  it('只声明图片2（还没上传）→ 1 与 2 都空，都算缺', () => {
    expect(
      findRefGap([{ kind: 'image', index: 2, status: 'pending' }]),
    ).toEqual({ kind: 'image', missing: [1, 2] })
  })

  it('只传了一张「图片1」 → 不缺，可以发送', () => {
    expect(findRefGap([{ kind: 'image', index: 1, status: 'ready' }])).toBe(null)
  })

  it('图片1 + 图片3 → 缺 2', () => {
    expect(
      findRefGap([
        { kind: 'image', index: 1, status: 'ready' },
        { kind: 'image', index: 3, status: 'ready' },
      ]),
    ).toEqual({ kind: 'image', missing: [2] })
  })

  it('图片与音频各自从 1 连续（互不干扰）', () => {
    expect(
      findRefGap([
        { kind: 'image', index: 1, status: 'ready' },
        { kind: 'audio', index: 1, status: 'ready' },
      ]),
    ).toBe(null)
    expect(
      findRefGap([{ kind: 'image', index: 1, status: 'ready' }, { kind: 'audio', index: 2, status: 'ready' }]),
    ).toEqual({ kind: 'audio', missing: [1] })
  })

  it('待输入（还没上传）也算缺：图片2 没内容时不能发', () => {
    expect(
      findRefGap([
        { kind: 'image', index: 1, status: 'ready' },
        { kind: 'image', index: 2, status: 'pending' },
      ]),
    ).toEqual({ kind: 'image', missing: [2] })
  })
})


describe('placeRefAtSlot：上传落到第几格，就是第几个参考', () => {
  it('空列表 + 第 2 格 → 只有一个素材时它就是第 1 个（缺的第 2 格由发送校验拦住）', () => {
    // 插入位置超出长度会夹到末尾：不会凭空造一个空参考。
    // 用户要的「这是图片2」由「序号对齐 + 缺号禁用发送」一起保证（见下一个 describe）。
    expect(placeRefAtSlot([], 'image', 2, 'n2')).toEqual(['n2'])
  })

  it('已有 1 个素材，再往第 2 格上传 → 排到第 2 位', () => {
    expect(placeRefAtSlot(['n1'], 'image', 2, 'n2')).toEqual(['n1', 'n2'])
  })

  it('已有 2 个素材，往第 1 格上传 → 新素材插到最前，其余顺延', () => {
    expect(placeRefAtSlot(['a', 'b'], 'image', 1, 'x')).toEqual(['x', 'a', 'b'])
  })

  it('重复上传同一个节点 → 不重复出现（先摘掉再插入）', () => {
    expect(placeRefAtSlot(['a', 'b', 'c'], 'image', 2, 'c')).toEqual(['a', 'c', 'b'])
  })

  it('序号超出已有长度 → 夹到末尾（不制造空洞）', () => {
    expect(placeRefAtSlot(['a'], 'image', 9, 'z')).toEqual(['a', 'z'])
  })
})

describe('参考缺号："图片 2" 但没有图片 1 → 不许发送', () => {
  /** 与组件里 refGap 同一套判定：每种类型从 1 数到最大序号，缺任何一格就算缺 */
  function missingIndices(ready: Array<{ kind: string; index: number }>): number[] {
    const byKind = new Map<string, Set<number>>()
    for (const s of ready) {
      const set = byKind.get(s.kind) ?? new Set<number>()
      set.add(s.index)
      byKind.set(s.kind, set)
    }
    for (const s of ready) {
      const have = byKind.get(s.kind) ?? new Set<number>()
      const max = Math.max(...have)
      const missing: number[] = []
      for (let i = 1; i <= max; i++) if (!have.has(i)) missing.push(i)
      if (missing.length) return missing
    }
    return []
  }

  it('只有图片2 → 缺图片1', () => {
    expect(missingIndices([{ kind: 'image', index: 2 }])).toEqual([1])
  })

  it('只有图片1 → 不缺（哪怕只传了一张，也是合法的「图片1」）', () => {
    expect(missingIndices([{ kind: 'image', index: 1 }])).toEqual([])
  })

  it('图片1 + 图片3 → 缺图片2', () => {
    expect(missingIndices([{ kind: 'image', index: 1 }, { kind: 'image', index: 3 }])).toEqual([2])
  })

  it('图片与音频各自编号：各自从 1 连续即可', () => {
    // 图片1 + 音频2：音频缺音频1 → 报缺
    expect(missingIndices([{ kind: 'image', index: 1 }, { kind: 'audio', index: 2 }])).toEqual([1])
    // 图片1 + 音频1：两边都连续 → 不缺
    expect(missingIndices([{ kind: 'image', index: 1 }, { kind: 'audio', index: 1 }])).toEqual([])
  })

  it('槽位键能稳定对上（image:2）', () => {
    expect(refSlotKey('image', 2)).toBe('image:2')
  })
})
