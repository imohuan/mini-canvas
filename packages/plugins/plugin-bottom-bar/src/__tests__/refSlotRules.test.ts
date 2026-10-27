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
    // 第 2 格 = 序列第 2 位（第 1 位用占位补上，落盘时占位被过滤）
    expect(d.getOrder()).toEqual(['__slot__0', 'n-new'])
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
  /**
   * 用户口径（2026-10-26，附两张截图）：
   *   ① 连了 3 条线就只有 3 格，不能凭空多出第 4、5 格；
   *   ② 声明了 @图片2、连线只有 1 条 → 内容在第 1 格，第 2 格显示「待输入」。
   *   格子身份 = **连线的序号**（collectUpstreamMaterials 的 refName），正文声明不产生内容。
   */
  it('连了 3 条线 → 只有 3 格（正文声明再多也不加格子）', () => {
    const tiles = mergeRefTiles(
      [
        { kind: 'image', index: 1 },
        { kind: 'image', index: 2 },
        { kind: 'image', index: 3 },
      ],
      [
        { id: 'a', name: '图片1', url: 'a.png', isText: false },
        { id: 'b', name: '图片2', url: 'b.png', isText: false },
        { id: 'c', name: '图片3', url: 'c.png', isText: false },
      ],
    )
    expect(tiles).toHaveLength(3)
    expect(tiles.every((t) => !t.pending)).toBe(true)
  })

  /**
   * 语义更新（用户 2026-10-27）：声明序号会先归一化成 1..n。
   * 所以「只声明了 1 个」时格数 = max(连线数, 1) = 1，不再按原始序号 2 补出第 2 格。
   */
  it('连线 1 条、声明 1 个 → 只有 1 格（归一化后不存在第 2 格）', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 1 }],
      [{ id: 'a', name: '图片1', url: 'a.png', isText: false }],
    )
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ index: 1, slotIndex: 1, pending: false, name: '图片1' })
  })

  it('连线 1 条、正文没写任何 @ → 只有 1 格（参考不凭空消失）', () => {
    const tiles = mergeRefTiles([], [{ id: 'a', name: '图片1', url: 'a.png', isText: false }])
    expect(tiles).toHaveLength(1)
    expect(tiles[0].pending).toBe(false)
  })

  it('连线 3 条但只声明 @图片2 → 仍是 3 格（第 3 格照常显示）', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 2 }],
      [
        { id: 'a', name: '图片1', url: 'a.png', isText: false },
        { id: 'b', name: '图片2', url: 'b.png', isText: false },
        { id: 'c', name: '图片3', url: 'c.png', isText: false },
      ],
    )
    expect(tiles).toHaveLength(3)
    expect(tiles.every((t) => !t.pending)).toBe(true)
  })

  it('图片与音频各自编号、按种类分格', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'audio', index: 1 }],
      [
        { id: 'a', name: '图片1', url: 'a.png', isText: false },
        { id: 'v', name: '音频1', url: 'v.mp3', isText: false },
      ],
    )
    expect(tiles.map((t) => t.label)).toEqual(['图片 1', '音频 1'])
    expect(tiles.every((t) => !t.pending)).toBe(true)
  })
})

describe('格子数量 = max(连线数, 归一化声明数)（用户 2026-10-27）', () => {
  it('只声明归一化后的 1 个、连线 4 条 → 4 格，全部有图', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 1 }],
      [
        { id: 'a', name: '图片1', url: 'a.png', isText: false },
        { id: 'b', name: '图片2', url: 'b.png', isText: false },
        { id: 'c', name: '图片3', url: 'c.png', isText: false },
        { id: 'd', name: '图片4', url: 'd.png', isText: false },
      ],
    )
    expect(tiles).toHaveLength(4)
    expect(tiles.every((t) => !t.pending)).toBe(true)
  })

  it('声明 3 个、连线 2 条 → 3 格（第 3 格空壳）', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'image', index: 1 }, { kind: 'image', index: 2 }, { kind: 'image', index: 3 }],
      [
        { id: 'a', name: '图片1', url: 'a.png', isText: false },
        { id: 'b', name: '图片2', url: 'b.png', isText: false },
      ],
    )
    expect(tiles).toHaveLength(3)
    expect(tiles[2]).toMatchObject({ pending: true, slotIndex: 3 })
  })
})

describe('参考缺号 → 不许发送（只看连线内容）', () => {
  it('声明 @图片2、连线只有 1 张图 → 不缺（第 1 格有内容，第 2 格待输入）', () => {
    // 第 2 格本身是待输入 → 也算缺（发出去会是空引用）
    expect(
      findRefGap([{ kind: 'image', index: 2 }], [{ id: 'a', name: '图片1', url: 'a.png', isText: false }]),
    ).toEqual({ kind: 'image', missing: [2] })
  })

  it('声明 @图片2、连线一张都没有 → 缺 1 和 2（两格都空）', () => {
    expect(findRefGap([{ kind: 'image', index: 2 }], [])).toEqual({ kind: 'image', missing: [1, 2] })
  })

  it('没写任何 @ → 不缺（普通参考图照旧）', () => {
    expect(findRefGap([], [{ id: 'a', name: '图片1', url: 'a.png', isText: false }])).toBe(null)
  })

  it('图片与音频各自判定', () => {
    expect(
      findRefGap([{ kind: 'audio', index: 2 }], [{ id: 'a', name: '图片1', url: 'a.png', isText: false }]),
    ).toEqual({ kind: 'audio', missing: [1, 2] })
  })
})



describe('placeRefAtSlot：上传落到第几格，就是第几个参考', () => {
  it('空列表 + 第 2 格 → 只有一个素材时它就是第 1 个（缺的第 2 格由发送校验拦住）', () => {
    // 第 2 格必须真的占第 2 位（前面补占位；落盘时占位被过滤，序号由 data.refSlot 保证）
    expect(placeRefAtSlot([], 'image', 2, 'n2')).toEqual(['__slot__0', 'n2'])
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
    // 第 9 格 = 第 9 位（补 7 个占位）；落盘时占位被过滤
    const out = placeRefAtSlot(['a'], 'image', 9, 'z')
    expect(out.length).toBe(9)
    expect(out[8]).toBe('z')
    expect(out.filter((x) => !x.startsWith('__slot__'))).toEqual(['a', 'z'])
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
