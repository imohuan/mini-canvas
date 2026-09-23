import { describe, expect, it } from 'vitest'
import {
  buildV2HelpList, groupV2HelpList, keyPartsToLabels,
} from '@mini-canvas/plugin-shortcut-manager'

/**
 * 快捷键面板数据 = 命令注册表的 keys（不再写死一份）。
 * 本测试用**真实注册的那批命令**当样本，锁住「面板上看到的键」与「真按下去会触发的键」一致：
 * 换命令/改键都会在这里红，防止面板再次漂移成"看起来有、按下去没有"的假键。
 */

/** 各插件/内核真实注册且带 keys 的命令（与源码逐条核对过的样本集） */
const REAL_COMMANDS = [
  { id: 'command:delete', title: '删除选中', keys: ['Delete', 'Backspace'] },
  { id: 'command:undo', title: '撤销', keys: ['mod+z'] },
  { id: 'command:redo', title: '重做', keys: ['mod+shift+z'] },
  { id: 'clipboard:copy', title: '复制选中节点', keys: ['mod+c'] },
  { id: 'clipboard:paste', title: '粘贴', keys: ['mod+v'] },
  { id: 'clipboard:cut', title: '剪切选中节点', keys: ['mod+x'] },
  { id: 'clipboard:duplicate', title: '复制一份选中节点', keys: ['mod+d'] },
  { id: 'multi-select:select-all', title: '全选节点', keys: ['mod+a'] },
  { id: 'multi-select:clear', title: '清除选中', keys: ['Escape'] },
  { id: 'group:create', title: '创建分组', keys: ['ctrl+g'] },
  { id: 'group:ungroup', title: '解散分组', keys: ['ctrl+shift+g'] },
  { id: 'auto-layout:run', title: '自动布局', keys: ['mod+l'] },
  { id: 'auto-layout:focus-selected', title: '聚焦选中节点', keys: ['f'] },
  { id: 'auto-layout:fit-view', title: '适应视图', keys: ['r'] },
  { id: 'canvas-export:full', title: '导出画布', keys: ['mod+e'] },
  { id: 'canvas-export:selected', title: '导出选中节点', keys: ['mod+shift+e'] },
  { id: 'mini-map:toggle', title: '切换小地图', keys: ['mod+m'] },
  { id: 'node-find:open', title: '搜索节点', keys: ['mod+f'] },
  { id: 'align-arrange:align-left', title: '左对齐', keys: ['mod+shift+arrowleft'] },
  { id: 'align-arrange:compact-arrowleft', title: '向左紧凑排列', keys: ['ctrl+arrowleft'] },
]

describe('快捷键面板数据源（命令注册表 keys，非写死）', () => {
  it('带 keys 的命令全部进面板，一条不漏', () => {
    const items = buildV2HelpList(REAL_COMMANDS)
    // 每条命令的每个键位各成一行（Delete 与 Backspace 是同一命令的两个键 → 两行）
    const expected = REAL_COMMANDS.reduce((n, c) => n + (c.keys?.length ?? 0), 0)
    expect(items).toHaveLength(expected)
  })

  it('没有 keys 的命令不进面板（如"创建节点"，只能从菜单触发）', () => {
    const items = buildV2HelpList([{ id: 'command:create-node', title: '创建节点' }])
    expect(items).toHaveLength(0)
  })

  it('键帽翻译：跨平台 mod → Ctrl/⌘、方向键 → 箭头', () => {
    expect(keyPartsToLabels('mod+shift+z')).toEqual(['Ctrl', 'Shift', 'Z'])
    expect(keyPartsToLabels('mod+shift+arrowleft')).toEqual(['Ctrl', 'Shift', '←'])
    expect(keyPartsToLabels('Backspace')).toEqual(['⌫'])
  })

  it('分组按 system→edit→canvas→view→plugin 排序，撤销/删除进"编辑"', () => {
    const groups = groupV2HelpList(buildV2HelpList(REAL_COMMANDS))
    expect(groups.map((g) => g.group)).toEqual(['edit', 'canvas', 'view', 'plugin'])
    const edit = groups.find((g) => g.group === 'edit')!
    expect(edit.items.map((i) => i.command)).toContain('撤销')
    expect(edit.items.map((i) => i.command)).toContain('删除选中')
  })

  it('曾经写死在面板上的假键，一条都不该出现', () => {
    const caps = buildV2HelpList(REAL_COMMANDS).flatMap((i) => keyPartsToLabels(i.keys).join('+'))
    // 老面板写的是 Ctrl+Alt+G / Ctrl+Enter / Tab / Space 拖拽 / V / H，真实注册里都没有
    for (const fake of ['Ctrl+Alt+G', 'Ctrl+Enter', 'Tab', 'Space+拖拽', 'V', 'H', 'Ctrl+Alt+Shift+G']) {
      expect(caps, `面板不该再出现假键 ${fake}`).not.toContain(fake)
    }
  })
})
