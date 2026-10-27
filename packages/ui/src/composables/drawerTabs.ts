/**
 * 左侧抽屉“插件页签”的纯逻辑。
 *
 * “插件页”不是路由、不是设置页：它就是左侧抽屉顶部的第三个及之后的页签，
 * 点中后抽屉正文切换成插件自己的面板（画布树/资产树暂时不渲染）。
 *
 * 为什么不让插件直接塞按钮：
 * - 宿主必须知道“当前选中的是谁”，否则多个插件会各自以为自己该显示；
 * - 只有按钮没有面板的注册会造成空白页，必须在登记时挡住；
 * - 插件卸载后当前页签会消失，宿主要负责回退。
 */

/** 插件页签的 meta：title 仅用于诊断；panel 是点中后显示的正文组件。 */
export interface DrawerTabMeta {
  title?: string
  panel?: unknown
}

/** 一条可用的插件页签（按钮 + 面板都齐了）。 */
export interface DrawerTabEntry {
  id: string
  order: number
  button: unknown
  panel: unknown
  title: string
}

export type DrawerTabsInvalidReason = 'reserved' | 'missing-panel' | 'missing-button'

export interface DrawerTabsInvalid {
  id: string
  reason: DrawerTabsInvalidReason
}

/**
 * 交给插件页签按钮/面板的窄接口。
 *
 * 插件只能“切页签 / 关抽屉 / 收起展开 / 读宽度”，不能直接改 ui.ts 的私有状态，
 * 也不能自己写 fixed 定位去找抽屉 DOM。
 */
export interface DrawerHost {
  readonly activeTab: string
  readonly width: number
  readonly collapsed: boolean
  openTab(id: string): void
  close(): void
  toggleCollapsed(): void
}

export const DRAWER_TAB_CANVAS = 'canvas'
export const DRAWER_TAB_ASSETS = 'assets'
export const DRAWER_TAB_RESERVED = [DRAWER_TAB_CANVAS, DRAWER_TAB_ASSETS]

/**
 * 把内核槽里的原始 occupant 收成“能显示的插件页签”。
 *
 * 不合法项不抛错：插件热装/热卸期间短暂缺面板是正常现象；
 * 调用方按 invalid 给一次 warn 即可（不产生空白页）。
 */
export function resolveDrawerTabs(
  occ: Array<{ id: string; order: number; component: unknown; meta?: unknown }>,
  opts: { reserved?: string[] } = {},
): { tabs: DrawerTabEntry[]; invalid: DrawerTabsInvalid[] } {
  const reserved = new Set(opts.reserved ?? DRAWER_TAB_RESERVED)
  const tabs: DrawerTabEntry[] = []
  const invalid: DrawerTabsInvalid[] = []

  for (const e of occ) {
    if (reserved.has(e.id)) {
      invalid.push({ id: e.id, reason: 'reserved' })
      continue
    }
    if (!e.component) {
      invalid.push({ id: e.id, reason: 'missing-button' })
      continue
    }
    const meta = (e.meta ?? {}) as DrawerTabMeta
    if (!meta.panel) {
      invalid.push({ id: e.id, reason: 'missing-panel' })
      continue
    }
    tabs.push({
      id: e.id,
      order: e.order,
      button: e.component,
      panel: meta.panel,
      title: meta.title ?? e.id,
    })
  }

  // order 相同按 id 排，保证热装顺序变化时页签不会无故互换位置。
  tabs.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { tabs, invalid }
}

/**
 * 当前页签消失后该回哪。
 *
 * 内置页签（canvas/assets）永远保留；插件页签不在了就回画布，
 * 避免用户看到一个空白正文，也避免把 leftTab 留成一个不存在的 id。
 */
export function fallbackDrawerTab(active: string, pluginIds: string[]): string {
  if (active === DRAWER_TAB_CANVAS || active === DRAWER_TAB_ASSETS) return active
  return pluginIds.includes(active) ? active : DRAWER_TAB_CANVAS
}
