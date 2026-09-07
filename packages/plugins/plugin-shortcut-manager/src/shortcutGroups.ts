/**
 * shortcutGroups —— 把「命令(含 keys)」归组成帮助面板列表的纯逻辑（零 Vue/DOM，可单测）。
 *
 * v2 数据源 = 命令注册表的 keys 字段（渲染层 CanvasHost 统一分发，无独立 shortcut 注册表）。
 * 本函数负责：挑出带 keys 的命令、按 areas/group 归组、排序；供面板渲染与测试复用。
 */

/** 命令的最小可展示形状（取自 CommandDef，缺省 title/group/areas） */
export interface ShortcutCommand {
  id: string
  title?: string
  keys?: string[]
  icon?: string
  areas?: string[]
  group?: string
  order?: number
}

/** 帮助面板的一条（命令 + 展示文本 + 归组键） */
export interface ShortcutHelpItem {
  id: string
  label: string
  combo: string
  group: string
  order: number
}

/** 面板分组顺序（未列出的组排后面） */
const GROUP_PRIORITY = ['编辑', '画布', '视图', '节点', '连线', '文件', '其他']

/** 从命令数组里挑带 keys 的并归组成有序帮助列表 */
export function buildShortcutHelpList(commands: ShortcutCommand[]): ShortcutHelpItem[] {
  const items: ShortcutHelpItem[] = []
  for (const c of commands) {
    if (!c.keys || c.keys.length === 0) continue
    for (const combo of c.keys) {
      const group = c.group ?? (c.areas && c.areas.length > 0 ? c.areas[0] : '其他')
      items.push({
        id: c.id + ':' + combo,
        label: c.title || c.id,
        combo,
        group: group === 'node' ? '节点' : group === 'edge' ? '连线' : group === 'pane' ? '画布' : group,
        order: c.order ?? 100,
      })
    }
  }
  items.sort((a, b) => {
    const ga = GROUP_PRIORITY.indexOf(a.group)
    const gb = GROUP_PRIORITY.indexOf(b.group)
    if (ga !== gb) return (ga === -1 ? 999 : ga) - (gb === -1 ? 999 : gb)
    if (a.order !== b.order) return a.order - b.order
    return a.label.localeCompare(b.label)
  })
  return items
}

export interface ShortcutRow {
  kind: 'group' | 'item'
  group?: string
  item?: ShortcutHelpItem
}

/** 把平铺帮助项按组拍平为「组头 + 项」渲染序列 */
export function toGroupedRows(items: ShortcutHelpItem[]): ShortcutRow[] {
  const rows: ShortcutRow[] = []
  let lastGroup: string | null = null
  for (const it of items) {
    if (it.group !== lastGroup) {
      rows.push({ kind: 'group', group: it.group })
      lastGroup = it.group
    }
    rows.push({ kind: 'item', item: it })
  }
  return rows
}
