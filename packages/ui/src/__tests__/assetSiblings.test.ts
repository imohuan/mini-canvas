/**
 * 「同级文件列表」的判定（assetSiblings.ts 纯函数）。
 *
 * 用户口径（2026-10-14）：「这两个区域的全局预览都提供一个列表，就是可以通过左右快捷键来回切换
 * 的那种效果。比如在文件夹里，它只处理同一级别的文件夹中的文件预览」。
 *
 * 这里锁的就是那句「只处理同一级别」：
 *   - 同一文件夹里的文件算一组；
 *   - 不跨文件夹、不带子文件夹里的文件、不带上一层；
 *   - 顺序 = rows 里看到的顺序（不另排序）；
 *   - 没有可加载地址的行跳过（切过去只会是一片空白）。
 */
import { describe, it, expect } from 'vitest'
import { siblingAssets, siblingPreview, type SiblingRow } from '../composables/assetSiblings'

const row = (kind: 'folder' | 'asset', id: string, parentId?: string, url?: string): SiblingRow => ({
  kind, id, name: id, ...(parentId ? { parentId } : {}), ...(url ? { url } : {}),
})

/**
 * 一棵小树（与 AssetTree 收到的扁平行同构）：
 *   根： 文件 a（根层）
 *   甲： 文件 b1、子文件夹 甲x（里面有 b1x）、文件 b2
 *   乙： 文件 c1
 */
const rows: SiblingRow[] = [
  row('asset', 'a', undefined, '/a.png'),
  row('folder', '甲'),
  row('asset', 'b1', '甲', '/b1.png'),
  row('folder', '甲x', '甲'),
  row('asset', 'b1x', '甲x', '/b1x.png'),
  row('asset', 'b2', '甲', '/b2.png'),
  row('folder', '乙'),
  row('asset', 'c1', '乙', '/c1.png'),
]

describe('同级文件列表', () => {
  it('只收同层、按 rows 里的可见顺序（甲里的 b1、b2；子文件夹里的不进来）', () => {
    expect(siblingAssets(rows, rows[2]).map((r) => r.id)).toEqual(['b1', 'b2'])
  })

  it('根层与各文件夹互不串门', () => {
    expect(siblingAssets(rows, rows[0]).map((r) => r.id)).toEqual(['a'])
    expect(siblingAssets(rows, rows[7]).map((r) => r.id)).toEqual(['c1'])
    expect(siblingAssets(rows, rows[4]).map((r) => r.id)).toEqual(['b1x'])
  })

  it('没有可加载地址的行跳过（切过去只会一片空白）', () => {
    const withDead: SiblingRow[] = [
      row('asset', 'x1', '甲', '/x1.png'),
      row('asset', 'x2', '甲'),
      row('asset', 'x3', '甲', '/x3.png'),
    ]
    expect(siblingAssets(withDead, withDead[0]).map((r) => r.id)).toEqual(['x1', 'x3'])
  })

  it('siblingPreview 给出 list / names / 当前下标', () => {
    const p = siblingPreview(rows, rows[5])
    expect(p.list).toEqual(['/b1.png', '/b2.png'])
    expect(p.names).toEqual(['b1', 'b2'])
    expect(p.index, 'b2 是甲里的第二张').toBe(1)
  })

  it('siblingPreview 带上每张的类型（切张时预览按当前张渲染，2026-10-28）', () => {
    const kinds: SiblingRow[] = [
      { kind: 'asset', id: 'v1', name: 'v1', parentId: '甲', url: '/v.mp4', assetKind: 'video' },
      { kind: 'asset', id: 'p1', name: 'p1', parentId: '甲', url: '/p.mcnode', assetKind: 'node-package' },
    ]
    const got = siblingPreview(kinds, kinds[0])
    expect(got.kinds).toEqual(['video', 'node-package'])
    expect(got.list).toEqual(['/v.mp4', '/p.mcnode'])
    expect(got.index).toBe(0)
  })

  it('行上没有 assetKind 时回落 other（不猜）', () => {
    const bare: SiblingRow[] = [
      { kind: 'asset', id: 'x', name: 'x', parentId: '甲', url: '/x.bin' },
    ]
    expect(siblingPreview(bare, bare[0]).kinds).toEqual(['other'])
  })

  it('当前行不在结果里时下标回 0（列表非空就得有个合法起点）', () => {
    const onlyOther: SiblingRow[] = [
      { kind: 'asset', id: 'p1', name: 'p1', parentId: '甲', url: '/p1.png' },
      { kind: 'asset', id: 'p2', name: 'p2', parentId: '甲', url: '/p2.png' },
    ]
    const missing: SiblingRow = { kind: 'asset', id: 'ghost', name: 'ghost', parentId: '甲', url: '/g.png' }
    const p = siblingPreview(onlyOther, missing)
    expect(p.index).toBe(0)
    expect(p.list).toEqual(['/p1.png', '/p2.png'])
  })

  it('单张时列表只有它自己（调用方据此退回不带列表的预览）', () => {
    expect(siblingPreview(rows, rows[0]).list).toEqual(['/a.png'])
  })
})
