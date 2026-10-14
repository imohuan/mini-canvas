/**
 * 批量勾选：Shift 区间 + 勾文件夹连带内容 + 窄版 tooltip（用户口径 2026-10-13）。
 *
 * 为什么用源码结构守（而不是只看纯函数单测）：纯函数测的是「判定本身对不对」，
 * 但这次的需求有一半是**接线**——两处宿主有没有都走同一份判定、勾选框和「点整行」有没有
 * 都把 Shift 传上去、文件夹的勾选态有没有走内容推导、抽屉那侧有没有补上提示。
 * 这些接线漂了，纯函数测试照样全绿（历史事故：缩略图、预览、菜单动作都在两处宿主间漂过）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const drawer = read('../components/areas/LeftDrawer.vue')
const dialog = read('../components/AssetManageDialog.vue')
const tree = read('../components/AssetTree.vue')
const batchBar = read('../components/AssetBatchBar.vue')

describe('批量勾选：两处宿主同一份判定', () => {
  it('两处宿主都用 composables/assetSelection，不自己写一套', () => {
    expect(drawer).toContain('composables/assetSelection')
    expect(dialog).toContain('composables/assetSelection')
    expect(dialog).toContain('applyRowClick(')
    // 弹窗原来那份「就地 toggleSelected」必须消失（否则两处口径又会漂移）
    expect(dialog).not.toContain('function toggleSelected(')
  })

  it('勾选框与「点整行」都把 Shift 传上去', () => {
    expect(tree).toContain("emit('toggleSelect', row.id, $event.shiftKey)")
    expect(tree).toContain("emit('openAsset', row, $event)")
    expect(drawer).toContain('shiftKey')
    expect(dialog).toContain('onTreeToggleSelect(row.id, Boolean(e?.shiftKey))')
  })

  it('「哪些行显示为勾上」走 checkedRowIds（文件夹勾选态由内容推导）', () => {
    expect(drawer).toContain('checkedRowIds(')
    expect(dialog).toContain('checkedRowIds(')
    expect(drawer).toContain(':selected-ids="checkedIds"')
    expect(dialog).toContain(':selected-ids="checkedIds"')
    // 直接把「已选 id 表」当勾选态喂给树是错的（文件夹永远亮不起来）
    expect(drawer).not.toContain(':selected-ids="s.assetSelectedIds"')
    expect(dialog).not.toContain(':selected-ids="selectedIds"')
  })

  it('两个宿主都把「行列表」传给判定（Shift 区间按可见行算）', () => {
    expect(drawer).toContain('rows: assetRows.value')
    expect(dialog).toContain('rows: rows.value')
  })
})

describe('批量条：窄版补提示 + 去掉主题色方块', () => {
  it('抽屉（compact）的图标按钮各挂一条 tooltip，宽版不重复挂', () => {
    expect(batchBar).toContain("import AxTooltip")
    const tips = (batchBar.match(/<AxTooltip/g) ?? []).length
    // 退出 / 添加到 / 移动到 / 修改标签 / 下载 / 删除 —— 6 个图标按钮各一条
    expect(tips).toBe(6)
    // 每条都只在紧凑模式生效（宽版本来就有文字，再挂气泡是重复）
    expect((batchBar.match(/:disabled="!compact"/g) ?? []).length).toBe(6)
    for (const label of ['退出批量操作', '添加到', '移动到', '修改标签', '下载', '删除']) {
      expect(batchBar).toContain('content="' + label + '"')
    }
  })

  it('计数区没有图标（用户口径：图标没必要，改成「已选多少项」）', () => {
    // 那颗对勾方块整块去掉；抽屉写「已选 N 项」、弹窗保持「已选择 N 项」
    expect(batchBar).not.toContain('rounded-[4px]')
    expect(batchBar).not.toContain('bg-brand')
    expect(batchBar).not.toContain('CheckIcon')
    expect(batchBar).toContain("'已选 ' + count + ' 项'")
    expect(batchBar).toContain("'已选择 ' + count + ' 项'")
  })
})
