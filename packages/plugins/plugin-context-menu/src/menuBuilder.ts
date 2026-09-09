/**
 * menuBuilder —— 右键菜单项组装纯逻辑（零 DOM、零 ctx，可单测）。
 *
 * 对齐老版 ContextMenuPlugin.resolveItems 的语义（v1 canvas-core/plugins/context-menu）：
 * - 模式(mode)：pane(右键空白/双击)/node(右键节点)/edge(右键连线)。
 * - 命令可见性：命令声明 areas 数组（'pane'|'node'|'edge'|'toolbar'...）。
 *     · 未声明 areas → 纯快捷键命令，不进任何右键模式；
 *     · 声明了 areas → 仅当包含当前 mode 才显示。
 * - 分组排序：group 分组、组内按 order 升序（数字小在前；未设 order 视为 100）。
 *   "新建节点" 区在最前。
 */

export type ContextMenuMode = 'pane' | 'node' | 'edge'

/** 命令最小形状（canvas-core-v2 CommandDef 的只读子集，避免强依赖具体实现） */
export interface MenuCommandLike {
  id: string
  title?: string
  description?: string
  areas?: string[]
  group?: string
  order?: number
  keys?: string[]
  icon?: string
}

/** 可创建节点类型最小形状（nodeStore.types 的只读子集） */
export interface MenuNodeTypeLike {
  type: string
  label: string
}

/** 一个右键菜单项 */
export interface ContextMenuItem {
  /** 稳定 id（命令 id 或新建节点 id） */
  id: string
  /** 展示文案 */
  label: string
  /** hover 描述（快捷键面板同款：行 hover 时 label 上移、下方浮现小字说明） */
  description?: string
  /** 分组名（显示层按组插分隔线） */
  group: string
  /** 组内排序（数字小在前） */
  order: number
  /** 菜单项类型：command = 执行注册命令；create-node = 新建某类型节点 */
  kind: 'command' | 'create-node'
  /** 当 kind=command：要执行的命令 id */
  commandId?: string
  /** 当 kind=create-node：要新建的节点类型 */
  nodeType?: string
  /** 是否危险操作（红字；删除类） */
  danger?: boolean
  /** 快捷键展示（命令 keys 数组原文，UI 自己格式化） */
  shortcut?: string[]
  /** 图标（svg 字符串，原样传显示层） */
  icon?: string
}

/** 组内默认 order（命令未声明 order 时的回退，排在声明了 order 的后面） */
const DEFAULT_ORDER = 100

/** 组间排序优先级（数字小越靠前）；未列出的组按组名出现顺序排在最后 */
const GROUP_PRIORITY: Record<string, number> = {
  create: 0,
  '操作': 1,
  '节点': 1,
  '连线': 2,
  action: 1,
  delete: 3,
  clipboard: 4,
  'align-arrange': 5,
  export: 6,
  view: 7,
}

/**
 * 命令是否在当前模式显示：只有显式声明 areas 且包含当前 mode 才显示
 * （未声明 areas = 纯快捷键命令，不进右键菜单）。
 */
export function commandVisibleInMode(cmd: MenuCommandLike, mode: ContextMenuMode): boolean {
  if (!cmd.areas || cmd.areas.length === 0) return false
  return cmd.areas.includes(mode)
}

/** 取分组优先级；未登记组给 999（按其名排最后，稳定） */
export function groupRank(group: string): number {
  return GROUP_PRIORITY[group] ?? 999
}

/**
 * 组装菜单项：
 * @param mode 当前右键模式
 * @param commands 当前已注册的全部命令（ctx.commands.list()）
 * @param nodeTypes 可新建的节点类型列表（nodeStore.types / nodeFactory.creatableTypes 映射）
 * @returns 已排序的菜单项（"新建节点"在前，命令按 组优先级→组内 order 升序）
 */
export function buildMenuItems(
  mode: ContextMenuMode,
  commands: readonly MenuCommandLike[],
  nodeTypes: readonly MenuNodeTypeLike[],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []

  // pane 模式（老版：右键空白 / 双击）显示"新建节点"子区
  if (mode === 'pane') {
    nodeTypes.forEach((t, index) => {
      items.push({
        id: 'create-node:' + t.type,
        label: t.label,
        group: 'create',
        order: index,
        kind: 'create-node',
        nodeType: t.type,
      })
    })
  }

  // 命令区：过滤可见 → 归一化
  for (const cmd of commands) {
    if (!commandVisibleInMode(cmd, mode)) continue
    const group = cmd.group || (mode === 'node' ? '节点' : mode === 'edge' ? '连线' : '操作')
    items.push({
      id: cmd.id,
      label: cmd.title || cmd.id,
      description: cmd.description,
      group,
      order: cmd.order ?? DEFAULT_ORDER,
      kind: 'command',
      commandId: cmd.id,
      danger: /delete|remove/i.test(cmd.id),
      shortcut: cmd.keys,
      icon: cmd.icon,
    })
  }

  return sortMenuItems(items)
}

/** 排序：组优先级升序 → 组内 order 升序（稳定排序，同组保持插入序） */
export function sortMenuItems(items: ContextMenuItem[]): ContextMenuItem[] {
  return [...items].sort((a, b) => {
    const ga = groupRank(a.group)
    const gb = groupRank(b.group)
    if (ga !== gb) return ga - gb
    return a.order - b.order
  })
}
