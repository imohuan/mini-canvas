/**
 * menuService —— 内核级菜单聚合（G 项：MenuRegistry 的轻量实现）。
 *
 * 解决的问题：右键菜单/工具栏都要"把命令表按模式/区域过滤 + 分组排序 + 加新建节点区"——
 * 此前这段纯逻辑在 plugin-context-menu 的 menuBuilder 里，其它 UI(工具栏/面板)无法复用。
 * 本服务把同一语义收进内核（消费 ctx.commands 已注册命令的 areas/group/order 元数据），
 * 宿主/插件 ctx.get('menu') 实时组装，菜单项不再依赖具体插件。
 *
 * areas 语义（开放注册规则）：命令作者在 register 时声明要出现在哪些 UI 区域。
 *   - 声明 areas（含 'pane'/'node'/'edge'/'toolbar' 之一）→ 出现在对应区域的菜单；
 *   - **未声明 areas → 纯快捷键命令，不进任何菜单**（撤销/重做/对齐/布局等靠快捷键可达，
 *     若放任其"通用显示"会污染右键菜单——老版用 registerShortcut/menus.register 两套注册区分，
 *     v2 单一命令表下用 areas 有无来区分）。
 *
 * 纯逻辑、零 Vue/DOM，Node 可单测。与 menuBuilder 同构（区域过滤/组优先级/组内 order/删除项 danger）。
 */

/** 菜单出现模式（对齐渲染层右键模式） */
export type MenuArea = 'pane' | 'node' | 'edge' | 'toolbar'

/** 一条已组装菜单项 */
export interface MenuItem {
  /** 稳定 id（命令 id 或 create-node:{type}） */
  id: string
  /** 展示文案 */
  label: string
  /** 分组名（UI 按组分隔线） */
  group: string
  /** 组内排序（小在前） */
  order: number
  /** 类型：command 执行注册命令 / create-node 新建某类型节点 */
  kind: 'command' | 'create-node'
  /** kind=command 时：要执行的命令 id */
  commandId?: string
  /** kind=create-node 时：要新建的节点类型 */
  nodeType?: string
  /** 危险操作（红字；删除类） */
  danger?: boolean
  /** 快捷键展示（keys 原文，UI 自格式化） */
  shortcut?: string[]
  icon?: string
}

/** 可创建节点类型（供 pane 菜单"新建节点"区） */
export interface MenuCreatableType {
  type: string
  label: string
}

/** 菜单聚合服务接口（ctx.get('menu')） */
export interface MenuService {
  /**
   * 组装某模式的菜单项（按序：新建节点区在前，命令按组优先级→组内 order）。
   * @param area 当前 UI 区域（pane/node/edge/toolbar）
   * @param creatableTypes 该模式可新建的节点类型（pane 才显示新建区；其余传 []）
   */
  menuFor(area: MenuArea, creatableTypes: readonly MenuCreatableType[]): MenuItem[]
}

/** 组内默认 order（命令未声明时） */
const DEFAULT_ORDER = 100

/** 组间优先级（小在前）；未登记组排在后面 */
const GROUP_PRIORITY: Record<string, number> = {
  create: 0, '操作': 1, '节点': 1, '连线': 2, action: 1, delete: 3, clipboard: 4, 'align-arrange': 5, export: 6, view: 7,
}

/** 取组优先级；未登记组给 999 */
function groupRank(group: string): number {
  return GROUP_PRIORITY[group] ?? 999
}

/** 命令是否在该区域显示：只有显式声明 areas 且包含当前 area 才显示（未声明 = 纯快捷键，不进菜单） */
function visibleInArea(cmd: { areas?: string[] }, area: MenuArea): boolean {
  if (!cmd.areas || cmd.areas.length === 0) return false
  return cmd.areas.includes(area)
}

/**
 * 建菜单聚合服务。
 * @param listCommands 取当前全部命令的函数（通常 () => ctx.commands.list()，每次现取保证实时）
 */
export function createMenuService(listCommands: () => Array<{ id: string; title?: string; areas?: string[]; group?: string; order?: number; keys?: string[]; icon?: string }>): MenuService {
  return {
    menuFor(area, creatableTypes) {
      const items: MenuItem[] = []
      // pane 区：新建节点子区在最前
      if (area === 'pane') {
        creatableTypes.forEach((t, index) => {
          items.push({ id: 'create-node:' + t.type, label: t.label, group: 'create', order: index, kind: 'create-node', nodeType: t.type })
        })
      }
      // 命令区：过滤可见 → 归一化
      for (const cmd of listCommands()) {
        if (!visibleInArea(cmd, area)) continue
        const group = cmd.group || (area === 'node' ? '节点' : area === 'edge' ? '连线' : '操作')
        items.push({
          id: cmd.id,
          label: cmd.title || cmd.id,
          group,
          order: cmd.order ?? DEFAULT_ORDER,
          kind: 'command',
          commandId: cmd.id,
          danger: /delete|remove/i.test(cmd.id),
          ...(cmd.keys ? { shortcut: cmd.keys } : {}),
          ...(cmd.icon ? { icon: cmd.icon } : {}),
        })
      }
      // 组优先级 → 组内 order 稳定排序
      return [...items].sort((a, b) => {
        const ga = groupRank(a.group)
        const gb = groupRank(b.group)
        if (ga !== gb) return ga - gb
        return a.order - b.order
      })
    },
  }
}
