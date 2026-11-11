/**
 * 设置页快捷键面板的数据契约：列表、冲突、导入导出与帮助浮层共用同一个管理器。
 * 面板是配置页，不再只是一条“打开帮助浮层”的动作。
 */
import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '@plume-canvas/kernel'
import { createV2ShortcutManager } from '../v2ShortcutManager'
import { buildSettingsShortcutGroups, filterSettingsShortcutGroups } from '../settingsPanelData'
import { readFileSync } from 'node:fs'

function managerWithCommands() {
  const c = new CommandRegistry()
  c.register({ id: 'command:undo', title: '撤销', keys: ['mod+z'], order: 1, run: () => {} })
  c.register({ id: 'command:delete', title: '删除选中', keys: ['Delete'], order: 2, run: () => {} })
  c.register({ id: 'command:help', title: '快捷键帮助', keys: ['mod+/'], order: 3, run: () => {} })
  return createV2ShortcutManager(c)
}

describe('设置页快捷键配置数据', () => {
  it('按分组列出命令，保留命令 id / 当前键位 / 描述', () => {
    const groups = buildSettingsShortcutGroups(managerWithCommands())
    expect(groups.map((g) => g.group)).toEqual(['edit', 'canvas'])
    const edit = groups.find((g) => g.group === 'edit')!
    expect(edit.items.map((i) => i.commandId)).toEqual(expect.arrayContaining(['command:undo', 'command:delete']))
    expect(edit.items.find((i) => i.commandId === 'command:undo')?.keys).toBe('mod+z')
  })

  it('搜索命令名 / 键位 / id，空结果不抛错', () => {
    const groups = buildSettingsShortcutGroups(managerWithCommands())
    expect(filterSettingsShortcutGroups(groups, '删除')).toHaveLength(1)
    expect(filterSettingsShortcutGroups(groups, 'ctrl+z')).toHaveLength(1)
    expect(filterSettingsShortcutGroups(groups, 'command:help')).toHaveLength(1)
    expect(filterSettingsShortcutGroups(groups, '没有这个命令')).toEqual([])
  })

  it('设置菜单是配置页，不再只广播动作；插件注册 settings.nav 页面', () => {
    const menu = readFileSync(new URL('../../../../plugins/plugin-theme-components/src/components/settings/defaultMenu.ts', import.meta.url), 'utf-8')
    expect(menu).toMatch(/id: 'nav\/personal\/shortcuts'[^\n]*title: '快捷键'[^\n]*order: 20 \}/)
    expect(menu).not.toMatch(/id: 'nav\/personal\/shortcuts'[^\n]*action:/)
    const plugin = readFileSync(new URL('../shortcutManagerPlugin.ts', import.meta.url), 'utf-8')
    expect(plugin).toMatch(/settings\.nav/)
    expect(plugin).toMatch(/nav\/personal\/shortcuts/)
    expect(plugin).toMatch(/SettingsShortcutPanel/)
  })
})
