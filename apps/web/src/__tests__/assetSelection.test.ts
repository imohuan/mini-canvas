/**
 * 资产树「批量勾选」的判定逻辑（纯函数，Node 侧跑）。
 *
 * 用户口径（2026-10-13）：
 *   ①「我选择文件夹后面的多选框之后，文件夹里面的所有内容就应该被选中呀，但是当前没有任何效果」
 *      —— 勾文件夹要连带它**直属的资产**一起勾上；随后又明确「选择文件夹的时候，不带上子文件夹」
 *      —— 子文件夹（以及子文件夹里的东西）不动。
 *   ②「使用 Shift+选 的话，根据你最后一次选择的一项，按 Shift 会选择该区间内的文件。
 *      这边不支持跨文件夹」—— 区间只在**同一层**（同一个父文件夹）内生效，跨层退化成普通点击。
 *
 * 为什么要有这组测试：同一个手势要在**两处宿主**（左侧抽屉 / 资产管理弹窗）表现一致，
 * 靠人眼在浏览器里两边各点一遍守不住（历史上缩略图、预览、菜单动作都漂移过）。
 */
import { describe, it, expect } from 'vitest'
import { applyRowClick, checkedRowIds, expandIds, folderContentIds, rangeRowIds } from '../composables/assetSelection'

interface Row {
  kind: 'folder' | 'asset'
  id: string
  parentId?: string
}

/** 一棵小树（扁平行，与 AssetTree 收到的一模一样）：f1 里有两个直属资产 + 一个子文件夹 f1x */
const rows: Row[] = [
  { kind: 'folder', id: 'f1' },
  { kind: 'asset', id: 'a1', parentId: 'f1' },
  { kind: 'folder', id: 'f1x', parentId: 'f1' },
  { kind: 'asset', id: 'a1x', parentId: 'f1x' },
  { kind: 'asset', id: 'a2', parentId: 'f1' },
  { kind: 'folder', id: 'f2' },
  { kind: 'asset', id: 'a3', parentId: 'f2' },
  { kind: 'folder', id: 'empty' },
  { kind: 'asset', id: 'r1' },
  { kind: 'asset', id: 'r2' },
]
const assets = [
  { id: 'a1', folderId: 'f1' },
  { id: 'a1x', folderId: 'f1x' },
  { id: 'a2', folderId: 'f1' },
  { id: 'a3', folderId: 'f2' },
  { id: 'r1' },
  { id: 'r2' },
]

/** 断言用：顺序不该是被测对象的一部分（判定只看集合） */
const sel = (ids: string[]): string[] => [...ids].sort()

function click(args: {
  selected?: string[]
  anchorId?: string | null
  id: string
  shift?: boolean
}): { selected: string[]; anchorId: string } {
  return applyRowClick({
    rows,
    assets,
    selected: args.selected ?? [],
    anchorId: args.anchorId ?? null,
    id: args.id,
    shift: args.shift ?? false,
  })
}

describe('folderContentIds（文件夹勾选连带哪些内容）', () => {
  it('只带**直属**资产：子文件夹里的资产不算', () => {
    expect(folderContentIds('f1', assets)).toEqual(['a1', 'a2'])
  })

  it('空文件夹 / 不存在的文件夹 → 空（不抛）', () => {
    expect(folderContentIds('f1x', assets)).toEqual(['a1x'])
    expect(folderContentIds('nope', assets)).toEqual([])
  })
})

describe('rangeRowIds（Shift 区间）', () => {
  it('同层两端之间的行都算进来（含两端，按行顺序）', () => {
    expect(rangeRowIds(rows, 'r1', 'r2')).toEqual(['r1', 'r2'])
    // a1（f1 下的资产）→ a2（同在 f1 下）：中间的 f1x / a1x 也是 f1 这一层，照收
    expect(rangeRowIds(rows, 'a1', 'a2')).toEqual(['a1', 'f1x', 'a1x', 'a2'])
  })

  it('反着点（后一个在前）也认', () => {
    expect(rangeRowIds(rows, 'a2', 'a1')).toEqual(['a1', 'f1x', 'a1x', 'a2'])
  })

  it('跨层（a1 在 f1、a3 在 f2）→ 空区间，调用方据此退化成普通点击', () => {
    expect(rangeRowIds(rows, 'a1', 'a3')).toEqual([])
  })
})

describe('expandIds（选中行 → 实际写进已选表的 id）', () => {
  it('文件夹行换成它的直属资产（文件夹本身不进已选表）；资产行原样', () => {
    expect(sel(expandIds(rows, ['f1'], assets))).toEqual(['a1', 'a2'])
    expect(sel(expandIds(rows, ['a3'], assets))).toEqual(['a3'])
    // 子文件夹里的资产不算（用户口径：选文件夹不带子文件夹）
    expect(expandIds(rows, ['f1x'], assets)).toEqual(['a1x'])
    expect(expandIds(rows, ['empty'], assets)).toEqual([])
  })
})

describe('checkedRowIds（文件夹的勾选态由内容推导）', () => {
  it('直属资产全在已选里 → 文件夹显示为勾上（按行顺序）', () => {
    expect(checkedRowIds(rows, ['a1', 'a2'], assets)).toEqual(['f1', 'a1', 'a2'])
  })

  it('只选了一半 → 文件夹不勾（资产行照旧）', () => {
    expect(checkedRowIds(rows, ['a1'], assets)).toEqual(['a1'])
  })

  it('空文件夹永远不勾（没有可操作的条目）', () => {
    expect(checkedRowIds(rows, [], assets)).toEqual([])
  })

  it('勾子文件夹的效果只落在它自己身上（不牵连父文件夹）', () => {
    // 只选了 a1x（f1x 里唯一一项）→ f1x 亮（它的内容全选了），f1 不亮；顺序跟行列表走
    expect(checkedRowIds(rows, ['a1x'], assets)).toEqual(['f1x', 'a1x'])
  })
})

describe('applyRowClick（一次勾选 → 新的已选 + 新锚点）', () => {
  it('勾文件夹 = 文件夹 + 直属资产一起选中（用户报的「没有任何效果」）', () => {
    const r = click({ id: 'f1' })
    expect(sel(r.selected)).toEqual(['a1', 'a2'])
    expect(r.anchorId).toBe('f1')
  })

  it('再点一次文件夹 = 连带取消', () => {
    const r = click({ id: 'f1', selected: ['a1', 'a2', 'r1'], anchorId: 'f1' })
    expect(sel(r.selected)).toEqual(['r1'])
  })

  it('空文件夹：点它不产生任何选中（但仍成为新锚点）', () => {
    const r = click({ id: 'empty', selected: ['r1'], anchorId: 'r1' })
    expect(sel(r.selected)).toEqual(['r1'])
    expect(r.anchorId).toBe('empty')
  })

  it('普通点击资产 = 只切换它自己', () => {
    expect(sel(click({ id: 'a1' }).selected)).toEqual(['a1'])
    expect(click({ id: 'a1', selected: ['a1'], anchorId: 'a1' }).selected).toEqual([])
  })

  it('Shift 同层：以最后一次点的那项为起点，区间全选', () => {
    const r = click({ id: 'r2', selected: ['r1'], anchorId: 'r1', shift: true })
    expect(sel(r.selected)).toEqual(['r1', 'r2'])
  })

  it('Shift 区间里夹着文件夹 → 文件夹的直属资产一起进来', () => {
    const r = click({ id: 'a2', selected: ['a1'], anchorId: 'a1', shift: true })
    // 行区间 a1..a2 = a1 / f1x / a1x / a2，f1x 是文件夹 → 带上它的直属资产 a1x（本来就在区间内）
    expect(sel(r.selected)).toEqual(['a1', 'a1x', 'a2'])
    // 锚点不动：下一次 Shift 还从这里算区间
    expect(r.anchorId).toBe('a1')
  })

  it('Shift 跨文件夹 → 退化成普通点击（不动已有的选中，只勾/取消这一项）', () => {
    const r = click({ id: 'a3', selected: ['a1'], anchorId: 'a1', shift: true })
    expect(sel(r.selected)).toEqual(['a1', 'a3'])
    expect(r.anchorId).toBe('a3')
  })

  it('Shift 落在已经全选的区间上 = 取消这个区间', () => {
    const r = click({ id: 'r2', selected: ['r1', 'r2', 'x'], anchorId: 'r1', shift: true })
    expect(sel(r.selected)).toEqual(['x'])
  })

  it('没有锚点（第一次就按 Shift）→ 普通点击', () => {
    const r = click({ id: 'r2', shift: true })
    expect(r.selected).toEqual(['r2'])
  })

  it('锚点已被删掉（不在行列表里）→ 普通点击兜底', () => {
    const r = click({ id: 'r2', selected: ['gone'], anchorId: 'gone', shift: true })
    expect(sel(r.selected)).toEqual(['gone', 'r2'])
  })
})
