/**
 * 参考卡片的核心规则（用户 2026-10-28 定案）。
 *
 * 一张卡 = 正文里的一颗标签；标签认节点 id、显示节点名称。
 * 添加（空卡）与替换（有内容）是同一条「绑定」路径；替换后名字跟着新节点走。
 * 失效引用（节点被删 / 断线 / 老格式）禁止发送。
 */
import { describe, expect, it } from 'vitest'
import { refNameChipId, refNodeChipId, type RefChip } from '../refSlots'
import {
  invalidRefHint,
  invalidRefTiles,
  matchMaterialByName,
  mergeRefTiles,
  nameFromFileName,
  nextChipOrder,
  targetOfTile,
  uniqueNodeName,
  uploadToRefSlot,
  type TileCardLike,
  type UploadDeps,
} from '../refTiles'
import { placeChipAt } from '../panelSource'

const card = (id: string, name: string, kind: TileCardLike['kind'] = 'image', url?: string): TileCardLike => ({
  id,
  name,
  kind,
  ...(url ? { url } : {}),
})

const bound = (nodeId: string, name: string): RefChip => ({
  id: refNodeChipId(nodeId),
  name,
  nodeId,
  pendingName: null,
  legacy: false,
})

const pending = (name: string): RefChip => ({
  id: refNameChipId(name),
  name,
  nodeId: null,
  pendingName: name,
  legacy: false,
})

describe('卡片行：名称来自节点，序号只做观察', () => {
  it('已绑定的卡显示节点名称（不是序号）', () => {
    const tiles = mergeRefTiles([bound('n1', '天空之城')], [card('n1', '天空之城', 'image', 'a.png')])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({
      key: 'ref-node:n1',
      label: '天空之城',
      kind: 'image',
      pending: false,
      invalid: false,
      index: 1,
    })
  })

  it('节点改名 → 卡片名称跟着变（标签显示永远以节点为准）', () => {
    const tiles = mergeRefTiles([bound('n1', '旧名字')], [card('n1', '新名字')])
    expect(tiles[0].label).toBe('新名字')
  })

  it('手打的待绑定标签 → 空壳卡，名称 = 手打的名字，类型未知', () => {
    const tiles = mergeRefTiles([pending('雨声')], [])
    expect(tiles[0]).toMatchObject({ key: 'ref-name:雨声', label: '雨声', pending: true, kind: null })
  })

  it('连了线但正文没写标签 → 也补一张卡（不吞素材）', () => {
    const tiles = mergeRefTiles([], [card('n1', '封面'), card('n2', '雨声', 'audio')])
    expect(tiles.map((t) => t.label)).toEqual(['封面', '雨声'])
    expect(tiles.map((t) => t.kind)).toEqual(['image', 'audio'])
  })

  it('拖拽顺序只改显示位（序号），不改身份与名字', () => {
    const chips = [bound('n1', '甲'), bound('n2', '乙')]
    const cards = [card('n1', '甲'), card('n2', '乙')]
    const tiles = mergeRefTiles(chips, cards, ['ref-node:n2', 'ref-node:n1'])
    expect(tiles.map((t) => t.key)).toEqual(['ref-node:n2', 'ref-node:n1'])
    expect(tiles.map((t) => t.label)).toEqual(['乙', '甲'])
    // 序号 = 显示位，只做观察
    expect(tiles.map((t) => t.index)).toEqual([1, 2])
  })
})

describe('失效引用：禁止发送（用户 2026-10-28：不做兼容）', () => {
  it('绑定的节点被删 / 断线 → 失效', () => {
    const tiles = mergeRefTiles([bound('gone', '天空之城')], [])
    expect(tiles[0]).toMatchObject({ invalid: true, label: '天空之城', nodeId: 'gone' })
    expect(invalidRefTiles(tiles)).toHaveLength(1)
    expect(invalidRefHint(tiles)).toContain('天空之城')
  })

  it('老格式 ref-slot:* → 失效（不猜它原来指向谁）', () => {
    const tiles = mergeRefTiles(
      [{ id: 'ref-slot:image:1', name: '图片1', nodeId: null, pendingName: null, legacy: true }],
      [card('n1', '天空之城')],
    )
    expect(tiles[0]).toMatchObject({ invalid: true, pending: false })
  })

  it('待绑定卡不算失效（只是还没拖东西进来）', () => {
    const tiles = mergeRefTiles([pending('雨声')], [])
    expect(invalidRefTiles(tiles)).toEqual([])
    expect(invalidRefHint(tiles)).toBe('')
  })
})

describe('标记：按名称匹配已连线素材', () => {
  it('命中 → 返回那个素材（名称唯一，不会有两个候选）', () => {
    const cards = [card('n1', '天空之城'), card('n2', '雨声', 'audio')]
    expect(matchMaterialByName('雨声', cards)?.id).toBe('n2')
  })

  it('没命中 → null（调用方转成待绑定标签）', () => {
    expect(matchMaterialByName('不存在', [card('n1', '天空之城')])).toBeNull()
  })

  it('前后空格不影响匹配', () => {
    expect(matchMaterialByName('  雨声 ', [card('n2', '雨声', 'audio')])?.id).toBe('n2')
  })
})

describe('新素材命名：文件名 + 画布内唯一（用户 2026-10-28）', () => {
  it('文件名去扩展名当节点名', () => {
    expect(nameFromFileName('天空之城.png')).toBe('天空之城')
    expect(nameFromFileName('雨声 v2.mp3')).toBe('雨声 v2')
  })

  it('没有扩展名 / 空名 → 原样或兜底', () => {
    expect(nameFromFileName('封面')).toBe('封面')
    expect(nameFromFileName('')).toBe('素材')
    expect(nameFromFileName('.gitignore')).toBe('.gitignore')
  })

  it('撞名追加序号（名称不允许重复）', () => {
    expect(uniqueNodeName('天空之城', ['天空之城'])).toBe('天空之城 2')
    expect(uniqueNodeName('天空之城', ['天空之城', '天空之城 2'])).toBe('天空之城 3')
  })

  it('名字自带序号 → 从那个号往上找，不叠成「天空之城 2 2」', () => {
    expect(uniqueNodeName('场景 3', ['场景 3'])).toBe('场景 4')
  })

  it('不撞名 → 原样使用', () => {
    expect(uniqueNodeName('雨声', ['天空之城'])).toBe('雨声')
  })
})

describe('替换 / 添加：同一条绑定路径', () => {
  it('空壳卡的目标：只有旧标签 id，没有旧节点', () => {
    const tiles = mergeRefTiles([pending('雨声')], [])
    expect(targetOfTile(tiles[0])).toEqual({ previousChipId: 'ref-name:雨声', pendingName: '雨声' })
  })

  it('有内容的卡：目标是换掉旧节点', () => {
    const tiles = mergeRefTiles([bound('n1', '天空之城')], [card('n1', '天空之城')])
    expect(targetOfTile(tiles[0])).toEqual({ previousChipId: 'ref-node:n1', oldNodeId: 'n1' })
  })

  it('placeChipAt：新标签顶替旧标签的位置；没有旧标签则追加', () => {
    expect(placeChipAt(['ref-node:a', 'ref-name:雨声', 'ref-node:c'], 'ref-name:雨声', 'b')).toEqual([
      'ref-node:a',
      'ref-node:b',
      'ref-node:c',
    ])
    expect(placeChipAt(['ref-node:a'], undefined, 'b')).toEqual(['ref-node:a', 'ref-node:b'])
  })
})

describe('nextChipOrder：拖拽落盘', () => {
  const tiles = [{ key: 'ref-node:a' }, { key: 'ref-node:b' }]

  it('顺序变了 → 返回新序列', () => {
    expect(nextChipOrder(['ref-node:a', 'ref-node:b'], tiles, [{ key: 'ref-node:b' }, { key: 'ref-node:a' }])).toEqual([
      'ref-node:b',
      'ref-node:a',
    ])
  })

  it('顺序没变 → null（不写盘、不进撤销栈）', () => {
    expect(nextChipOrder(['ref-node:a', 'ref-node:b'], tiles, tiles)).toBeNull()
  })

  it('异常形状 → 退回当前顺序', () => {
    expect(nextChipOrder([], tiles, undefined)).toEqual(['ref-node:a', 'ref-node:b'])
  })
})

describe('上传：建节点 → 还选中 → 等帧 → 连线', () => {
  function deps(overrides: Partial<UploadDeps> = {}) {
    const calls: string[] = []
    const base: UploadDeps = {
      addFiles: async () => { calls.push('addFiles'); return 1 },
      waitTick: async () => { calls.push('waitTick') },
      afterCreate: () => { calls.push('afterCreate') },
      addEdge: () => { calls.push('addEdge'); return 'e1' },
      pickCreated: () => ({ id: 'n-new', name: '新素材', url: 'u' }),
      positionFor: () => ({ x: -100, y: 0 }),
    }
    return { deps: { ...base, ...overrides }, calls }
  }

  it('成功时顺序固定', async () => {
    const d = deps()
    const r = await uploadToRefSlot({ file: new File([], 'a.png'), targetId: 'me' }, d.deps)
    expect(r.ok).toBe(true)
    expect(d.calls).toEqual(['addFiles', 'afterCreate', 'waitTick', 'addEdge'])
    expect(r.created?.id).toBe('n-new')
  })

  it('没建出节点 → 不连线', async () => {
    const d = deps()
    d.deps.addFiles = async () => { d.calls.push('addFiles'); return 0 }
    const r = await uploadToRefSlot({ file: new File([], 'a.txt'), targetId: 'me' }, d.deps)
    expect(r.ok).toBe(false)
    expect(d.calls).toEqual(['addFiles'])
  })

  it('连线失败 → 报错', async () => {
    const d = deps({ addEdge: () => null })
    const r = await uploadToRefSlot({ file: new File([], 'a.png'), targetId: 'me' }, d.deps)
    expect(r.ok).toBe(false)
  })
})
