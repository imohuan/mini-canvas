/**
 * menuEnrich —— 右键菜单项 UI 增强（图标 + hover 描述；纯函数可单测）。
 *
 * 与快捷键帮助面板同一套 item 视觉：左侧图标托 + 名称(hover 浮现描述) + 右侧快捷键。
 * 命令本身只声明 id/title/keys（不背 UI 装饰），菜单在此层补齐：
 * - 图标：按 命令 id 关键字/新建节点类型 给线性 SVG（无命中给通用默认图标，保证图标列恒在）；
 * - 描述：命令类按 id 关键字在这里补；**新建节点类取自节点类型注册时声明的 description**
 *   （与 icon 同一条链：插件 ctx.nodes.register → nodeStore 类型表 → 菜单项），
 *   本层不再按 type 名字维护对照表 —— 那样每加一个节点类型都要回来改这里，必漏。
 */
import { iconRenderMode } from '@mini-canvas/kernel'
import type { ContextMenuItem } from './menuBuilder'

/** 通用描边图标路径集（viewBox 0 0 24 24, stroke=currentColor, 2px） */
const ICONS: Record<string, string> = {
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  duplicate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M16 5v-1a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 1 1.7"/></svg>',
  paste:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>',
  default:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>',
}

/**
 * 兜底图标键：
 * - create-node：图标来自节点类型注册（menuBuilder 已带上）；这里只在未注册时给 default 占位，不按 type 名字猜。
 * - command：命令只声明 id/title（不背 UI 装饰），按 id 关键字给语义图标。
 */
function iconKeyOf(item: ContextMenuItem): string {
  if (item.kind === 'create-node') return 'default'
  const id = item.commandId ?? ''
  if (/delete|remove/i.test(id)) return 'trash'
  if (/duplicate/i.test(id)) return 'duplicate'
  if (/copy/i.test(id)) return 'copy'
  if (/paste/i.test(id)) return 'paste'
  return 'default'
}

/** 菜单项描述（hover 浮现小字）；未命中给空（行保持单行高） */
const DESCRIPTIONS: Record<string, string> = {
  'clipboard:paste': '在鼠标位置粘贴剪贴板内容',
  'clipboard:copy': '复制当前选中的节点',
  'clipboard:duplicate': '原位复制一份当前选中节点',
  'context-menu:delete-node': '移除该节点及相连的连线',
  'context-menu:delete-edge': '移除该连线（保留两端节点）',
}

/**
 * 给菜单项补 icon/description（保持入参顺序）。
 * create-node 项的 description 已由节点类型声明带下来（menuService/menuBuilder 透传），此处原样保留；
 * 只有命令项才按 id 查上面的表。两处都不命中就给空串 —— 行保持单行高。
 */
export function enrichMenuItems(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  return items.map((it) => {
    const descKey = it.commandId ?? it.id
    return {
      ...it,
      icon: iconRenderMode(it.icon) === 'none' ? ICONS[iconKeyOf(it)] : it.icon,
      description: it.description || DESCRIPTIONS[descKey] || '',
    }
  })
}
