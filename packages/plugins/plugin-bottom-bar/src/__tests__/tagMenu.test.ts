/**
 * 标签菜单（图 4）的纯逻辑单测：分组 / 搜索 / 自然序 / 已引用优先。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildTagMenuGroups, naturalCompare, type TagMenuEntry } from '../tagMenu'

const entry = (id: string, name: string, kind: TagMenuEntry['kind'], referenced = false): TagMenuEntry => ({
  id, name, kind, referenced,
})

describe('标签菜单分组', () => {
  it('已引用排最前，其余按 图片/视频/音频/文本 分组', () => {
    const groups = buildTagMenuGroups([
      entry('1', '人物肖像保护', 'image', true),
      entry('2', '图片', 'image'),
      entry('3', '视频', 'video'),
      entry('4', '音频', 'audio'),
      entry('5', '文本', 'text'),
    ], '')
    expect(groups.map((g) => g.label)).toEqual(['已引用', '图片', '视频', '音频', '文本'])
  })

  it('没有已引用时不出现空组（图 4 里「已引用」只在有内容时出现）', () => {
    const groups = buildTagMenuGroups([entry('2', '图片', 'image')], '')
    expect(groups.map((g) => g.kind)).toEqual(['image'])
  })

  it('搜索同时匹配名称与 id，命中后仍保留分组结构', () => {
    const groups = buildTagMenuGroups([
      entry('img-1', '角色设定图', 'image'),
      entry('img-2', '720°全景图', 'image'),
      entry('vid-1', '画面推演', 'video'),
    ], '推演')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('视频')
    expect(groups[0].items.map((i) => i.name)).toEqual(['画面推演'])
  })

  it('搜索匹配 id（用户按 id 找节点也能筛出来）', () => {
    const groups = buildTagMenuGroups([entry('img-77', '甲', 'image'), entry('img-88', '乙', 'image')], 'img-88')
    expect(groups[0].items.map((i) => i.id)).toEqual(['img-88'])
  })

  it('组内按自然序（图片2 在 图片10 前面，不是字典序）', () => {
    const groups = buildTagMenuGroups([
      entry('a', '图片10', 'image'),
      entry('b', '图片2', 'image'),
    ], '')
    expect(groups[0].items.map((i) => i.name)).toEqual(['图片2', '图片10'])
  })

  it('空查询不丢任何素材', () => {
    const all = [entry('1', 'A', 'image'), entry('2', 'B', 'video'), entry('3', 'C', 'audio')]
    const total = buildTagMenuGroups(all, '').reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(3)
  })
})

describe('naturalCompare', () => {
  it('数字按大小比，不按字符比', () => {
    expect(['图片10', '图片2'].sort(naturalCompare)).toEqual(['图片2', '图片10'])
  })
})

describe('标签菜单 DOM 契约（编辑器的两半分流）', () => {
  it('编辑器把点击位置分成「左侧图标」与「右侧文字」两条路', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../../prosemirror-editor-bundle/src/useEditor.ts', import.meta.url)), 'utf8')
    expect(src).toContain('onIconClick')
    expect(src).toContain('clickInsideChipIcon')
    // 点图标优先：命中图标就交给调用方，不再走默认的「延迟落光标」
    const idx = src.indexOf('&& clickInsideChipIcon')
    expect(idx).toBeGreaterThan(0)
    // 图标分支必须排在文本分支（chipClickTimer 落光标）之前
    const iconBranchEnd = src.indexOf('const pos = view.posAtDOM', idx)
    expect(iconBranchEnd).toBeGreaterThan(idx)
    expect(src.slice(idx, iconBranchEnd)).not.toContain('chipClickTimer = setTimeout')
  })

  it('标签菜单用主题 Dropdown（不是自绘浮层）', () => {
    const sfc = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')
    expect(sfc).toContain('body-class="nb-tagmenu-body"')
    expect(sfc).toContain('v-model="tagMenuOpen"')
    // 数据源 = 整个画布（doc.getNodes），不是当前连线
    expect(sfc).toContain('buildTagMenuGroups(tagMenuEntries.value')
    // 两栏结构（左类别 / 右节点，图 4），不是平铺一列
    expect(sfc).toContain('nb-tagmenu-panes')
    expect(sfc).toContain('tagMenuSections')
  })
})

describe('标签的两半点击（用户 2026-10-29 定稿）', () => {
  const EDITOR = readFileSync(fileURLToPath(new URL('../../../../prosemirror-editor-bundle/src/useEditor.ts', import.meta.url)), 'utf8')

  it('点右侧文字 = 1 秒后把光标落到标签后面（默认行为）', () => {
    expect(EDITOR).toContain('CHIP_CARET_DELAY = 1000')
    expect(EDITOR).toMatch(/\}, CHIP_CARET_DELAY\)/)
  })

  it('图标位的命中按真实矩形算（缩略图 pointer-events:none，只能按坐标判）', () => {
    const body = EDITOR.slice(EDITOR.indexOf('function chipIconRect'), EDITOR.indexOf('function handleResourceClick'))
    expect(body).toContain('resource-chip-thumb')
    expect(body).toContain('getBoundingClientRect')
  })

  it('点图标分支排在文本分支前面，且会取消待落的 1s 光标', () => {
    const iconAt = EDITOR.indexOf('&& clickInsideChipIcon')
    const textAt = EDITOR.indexOf('const pos = view.posAtDOM', iconAt)
    expect(iconAt).toBeGreaterThan(0)
    expect(textAt).toBeGreaterThan(iconAt)
    expect(EDITOR.slice(iconAt, textAt)).toContain('clearTimeout(chipClickTimer)')
  })
})

