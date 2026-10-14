import { describe, expect, it } from 'vitest'
import {
  buildMenuItems,
  commandVisibleInMode,
  sortMenuItems,
  splitMenuPath,
  topGroupOf,
  type MenuCommandLike,
  type MenuNodeTypeLike,
} from '../menuBuilder'

/**
 * 二级菜单：注册方在 group / title 里写斜杠就落成嵌套。
 *
 * 为什么用"斜杠"当约定：注册方（插件、成品应用）最自然的写法就是给一个名字，
 * 让它再学一套嵌套结构是多余的门槛；而斜杠写法的语义与设置面板的分组路径一致，
 * 用户一看就懂"这是下一层"。
 */
describe('splitMenuPath —— 斜杠 = 下一层', () => {
  it('按斜杠拆段', () => {
    expect(splitMenuPath('资源库')).toEqual(['资源库'])
    expect(splitMenuPath('资源库/节点')).toEqual(['资源库', '节点'])
    expect(splitMenuPath('资源库/节点/画笔')).toEqual(['资源库', '节点', '画笔'])
  })

  it('空段丢掉、两端去空白（`资源库 // ` 不该多出一层空菜单）', () => {
    expect(splitMenuPath(' 资源库 / 节点 ')).toEqual(['资源库', '节点'])
    expect(splitMenuPath('资源库//节点/')).toEqual(['资源库', '节点'])
  })

  it('空/未给 → 空路径（调用方据此走"不嵌套"的老行为）', () => {
    expect(splitMenuPath(undefined)).toEqual([])
    expect(splitMenuPath('')).toEqual([])
    expect(splitMenuPath('   ')).toEqual([])
  })
})

describe('topGroupOf —— 排序与分组看首段', () => {
  it('有 path 取首段；没有就看 group', () => {
    expect(topGroupOf({ group: '资源库/节点', path: ['资源库', '节点'] })).toBe('资源库')
    expect(topGroupOf({ group: '节点' })).toBe('节点')
  })

  it('嵌套项的排序按**首段**取优先级，不因为整串查不到而被扔到最后', () => {
    const items = buildMenuItems(
      'node',
      [
        { id: 'a', title: '某插件动作', areas: ['node'], group: '插件' },
        { id: 'b', title: '画笔', areas: ['node'], group: '资源库/节点', order: 1 },
      ],
      [],
    )
    // 资源库不在优先级表里 → 与"插件"同为 999，组内按 order ⇒ b 在前
    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })
})

const nodeTypes: MenuNodeTypeLike[] = [
  { type: 'text', label: '文本' },
  { type: 'image', label: '图片' },
]

/** 造命令 */
function cmd(partial: Partial<MenuCommandLike> & { id: string }): MenuCommandLike {
  return partial
}

describe('commandVisibleInMode', () => {
  it('areas 未声明或空 = 纯快捷键命令，不进任何模式菜单', () => {
    expect(commandVisibleInMode(cmd({ id: 'a' }), 'pane')).toBe(false)
    expect(commandVisibleInMode(cmd({ id: 'a', areas: [] }), 'node')).toBe(false)
    expect(commandVisibleInMode(cmd({ id: 'a', areas: [] }), 'edge')).toBe(false)
  })

  it('areas 声明了 → 仅当包含当前 mode 可见', () => {
    const c = cmd({ id: 'a', areas: ['node'] })
    expect(commandVisibleInMode(c, 'node')).toBe(true)
    expect(commandVisibleInMode(c, 'pane')).toBe(false)
    expect(commandVisibleInMode(c, 'edge')).toBe(false)
  })
})

describe('buildMenuItems', () => {
  it('create-node 项透传节点类型声明的 icon', () => {
    const SvgIcon = '<svg viewBox="0 0 24 24"></svg>'
    const items = buildMenuItems('pane', [], [
      { type: 'text', label: '文本', icon: SvgIcon },
      { type: 'plain', label: '无图标' },
    ])
    expect(items[0].icon).toBe(SvgIcon)
    expect(items[1].icon).toBeUndefined()
  })

  it('create-node 项透传节点类型声明的 description（hover 小字由类型自己带）', () => {
    const items = buildMenuItems('pane', [], [
      { type: 'text', label: '文本', description: '在画布中添加一个文本节点' },
      { type: 'plain', label: '无描述' },
    ])
    expect(items[0].description).toBe('在画布中添加一个文本节点')
    expect(items[1].description).toBeUndefined()
  })

  it('pane 模式：新建节点区在前，再排 pane/通用命令', () => {
    const commands = [
      cmd({ id: 'multi-select:select-all', title: '全选', areas: ['pane'], order: 10 }),
      cmd({ id: 'clipboard:paste', title: '粘贴', areas: ['pane'], group: 'clipboard', order: 20 }),
    ]
    const items = buildMenuItems('pane', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual([
      'create-node:text',
      'create-node:image',
      'multi-select:select-all',
      'clipboard:paste',
    ])
    expect(items[0].kind).toBe('create-node')
    expect(items[0].nodeType).toBe('text')
    expect(items[3].kind).toBe('command')
    expect(items[3].commandId).toBe('clipboard:paste')
  })

  it('node 模式：只显示 node 区命令，不显示新建节点区', () => {
    const commands = [
      cmd({ id: 'context-menu:delete-node', title: '删除节点', areas: ['node'], order: 10 }),
      cmd({ id: 'clipboard:paste', title: '粘贴', areas: ['pane'], group: 'clipboard' }),
      cmd({ id: 'align-arrange:align-left', title: '左对齐', group: 'align-arrange' }),
    ]
    const items = buildMenuItems('node', commands, nodeTypes)
    // pane 区命令不显示；无 areas 命令(纯快捷键)不显示；node 区命令显示
    expect(items.map((i) => i.id)).toContain('context-menu:delete-node')
    expect(items.map((i) => i.id)).not.toContain('align-arrange:align-left')
    expect(items.map((i) => i.id)).not.toContain('clipboard:paste')
    expect(items.some((i) => i.kind === 'create-node')).toBe(false)
  })

  it('edge 模式：只显示 edge 区命令', () => {
    const commands = [
      cmd({ id: 'context-menu:delete-edge', title: '删除连线', areas: ['edge'], order: 10 }),
      cmd({ id: 'context-menu:delete-node', title: '删除节点', areas: ['node'] }),
    ]
    const items = buildMenuItems('edge', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual(['context-menu:delete-edge'])
  })

  it('删除类命令标 danger', () => {
    const commands = [cmd({ id: 'context-menu:delete-edge', title: '删除连线', areas: ['edge'] })]
    const items = buildMenuItems('edge', commands, nodeTypes)
    expect(items[0].danger).toBe(true)
  })

  it('无可见命令 + 非 pane → 返回空（浮层不弹）', () => {
    const commands = [cmd({ id: 'x', title: 'X', areas: ['pane'] })]
    expect(buildMenuItems('edge', commands, nodeTypes)).toEqual([])
  })

  it('命令未声明 order → 排在声明了 order 的后面（同组）', () => {
    const commands = [
      cmd({ id: 'node:delete', title: '删除', areas: ['node'], group: '节点' }),
      cmd({ id: 'node:duplicate', title: '复制一份', areas: ['node'], group: '节点', order: 20 }),
      cmd({ id: 'node:copy', title: '复制', areas: ['node'], group: '节点', order: 10 }),
    ]
    const items = buildMenuItems('node', commands, nodeTypes)
    expect(items.map((i) => i.id)).toEqual(['node:copy', 'node:duplicate', 'node:delete'])
  })

  it('组名写斜杠 → 落成嵌套路径（显示层据此做二级菜单）', () => {
    const commands: MenuCommandLike[] = [
      { id: 'pkg:paint', title: '画笔', areas: ['node'], group: '资源库/节点', order: 1 },
      { id: 'pkg:video', title: '视频可视化', areas: ['node'], group: '资源库/节点', order: 2 },
    ]
    const items = buildMenuItems('node', commands, [])
    expect(items[0].path).toEqual(['资源库', '节点'])
    // label 只放叶子名（"节点"是第一层入口，由显示层画成带子菜单的行）
    expect(items.map((i) => i.label)).toEqual(['画笔', '视频可视化'])
  })

  it('项名写斜杠也能嵌套（group 给外层、title 给下层）', () => {
    const commands: MenuCommandLike[] = [{ id: 'pkg:x', title: '节点/画笔', areas: ['node'], group: '资源库' }]
    const items = buildMenuItems('node', commands, [])
    expect(items[0].path).toEqual(['资源库', '节点', '画笔'])
  })

  it('不写斜杠 = 路径只有一段（老注册方行为不变）', () => {
    const commands: MenuCommandLike[] = [{ id: 'node:dup', title: '复制一份', areas: ['node'], group: '节点' }]
    const items = buildMenuItems('node', commands, [])
    expect(items[0].path).toEqual(['节点'])
    expect(items[0].group).toBe('节点')
  })
})

describe('sortMenuItems', () => {
  it('按组优先级升序、组内 order 升序排序', () => {
    const items = sortMenuItems([
      { id: 'b', label: 'B', group: '操作', order: 2, kind: 'command', commandId: 'b' },
      { id: 'a', label: 'A', group: '操作', order: 1, kind: 'command', commandId: 'a' },
      { id: 'c', label: 'C', group: 'create', order: 0, kind: 'create-node', nodeType: 'text' },
    ])
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('「资源库」排在「剪贴板（粘贴）」之前 —— 用户口径：加东西那一族要排在粘贴上面', () => {
    const items = sortMenuItems([
      { id: 'clipboard:paste', label: '粘贴', group: 'clipboard', order: 20, kind: 'command', commandId: 'clipboard:paste' },
      { id: 'ui:import-pack:x', label: '某节点包', group: '资源库/节点包', order: 10, kind: 'command', commandId: 'ui:import-pack:x' },
    ])
    expect(items.map((i) => i.id)).toEqual(['ui:import-pack:x', 'clipboard:paste'])
  })
})
