/**
 * agentResources —— 把「技能 / MCP」翻译成输入框认识的 **资源标签**（@ 引用项）。
 *
 * 为什么要单独一份：技能与 MCP 在输入框里有两种身份 ——
 *   ① @ 菜单里的一行（renderItem，点一下插成标签）；
 *   ② 插进正文后的**内联标签**外观（renderEditor，左侧图标 + 右侧标题）。
 * 两处必须是同一套图标与文案，否则「菜单里是 A 的样子、插进去变成 B」。
 *
 * 图标用**内联 SVG 字符串**（不是 VNode）：标签由 ProseMirror 直接造 DOM 渲染，
 * 拿不到 Vue 组件实例；字符串是两边都能用的形式。
 */
import { h, type VNode } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { McpRow, SkillRow } from './agentService.js'

/** 技能图标（魔杖 + 星光）：与工具栏上的技能按钮同源 */
export const ICON_SKILL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6 3.5m2 8c.5-1.5 1.5-2.5 3-3"/></svg>'

/** MCP 图标（插头）：与工具栏上的 MCP 按钮同源 */
export const ICON_MCP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>'

/** 标签里那枚图标：ProseMirror 直接把这串 HTML 塞进 span */
function iconSpan(svg: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'ac-tag-icon'
  el.innerHTML = svg
  return el
}

/** ProseMirror 造标签时调的工厂：渲染成「[图标] 标题」 */
function renderTag(svg: string, label: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'ac-tag'
  const lb = document.createElement('span')
  lb.className = 'ac-tag-label'
  lb.textContent = label
  el.append(iconSpan(svg), lb)
  return el
}

/** @ 菜单里的那一行：图标 + 标题 + 次要说明（与插入后的标签同款图标） */
function renderMenuRow(svg: string, name: string, hint: string): VNode {
  return h('span', { class: 'ac-mrow' }, [
    h('span', { class: 'ac-mrow-icon', innerHTML: svg }),
    h('span', { class: 'ac-mrow-text' }, [
      h('span', { class: 'ac-mrow-name' }, name),
      hint ? h('span', { class: 'ac-mrow-hint' }, hint) : null,
    ]),
  ])
}

/** 已装技能 → 资源标签（名字就是触发关键词，@ 或直接点列表插入） */
export function skillResources(skills: SkillRow[]): ResourceItem[] {
  return skills.map((sk) => ({
    id: 'skill:' + sk.name,
    name: sk.name,
    category: '技能',
    value: sk.description,
    // 引用标记：带**说明书路径**（skill.dir 是后端给的技能目录，不是文件）。
    // 后端据它写一句「说明书在 <路径>，需要时自己读」，不再贴正文（用户口径）。
    ref: { kind: 'skill', name: sk.name, value: skillDirOf(sk) },
    renderItem: () => renderMenuRow(ICON_SKILL, sk.name, sk.description),
    renderEditor: () => renderTag(ICON_SKILL, sk.name),
  }))
}

/** 已配 MCP → 资源标签（次要说明优先显示地址/命令，便于区分同名服务） */
export function mcpResources(servers: McpRow[]): ResourceItem[] {
  return servers.map((m) => {
    const hint = String(m.config?.url ?? m.config?.command ?? m.config?.type ?? '')
    return {
      id: 'mcp:' + m.name,
      name: m.name,
      category: 'MCP',
      value: hint,
      // MCP 的标记**不带地址**（用户口径）：后端靠服务名决定这次连哪几个。
      ref: { kind: 'mcp', name: m.name },
      renderItem: () => renderMenuRow(ICON_MCP, m.name, hint),
      renderEditor: () => renderTag(ICON_MCP, m.name),
    }
  })
}

/**
 * 技能目录 → SKILL.md 路径。
 *
 * 后端的 SkillRow 只给名字与说明，不给路径；约定技能说明书固定叫 `SKILL.md`，
 * 而技能目录落在 `<app_data_dir>/agents/<agent>/agent_state/skills/<name>/`。
 * 路径拿不到时返回空串：标记仍成立（后端只说「技能已生效」），只是少了路径提示。
 */
function skillDirOf(sk: SkillRow & { dir?: string; path?: string }): string {
  const base = sk.dir ?? sk.path
  if (!base) return ''
  return base.replace(/[\\/]+$/, '') + '/SKILL.md'
}

/** 画布节点的最小形状（左抽屉 / @ 菜单都用它；不 import 数据层类型） */
export interface CanvasNodeRow {
  id: string
  name: string
  type: string
}

/** 节点图标（按类型粗分；装饰用，认不出就当通用节点） */
export const ICON_NODE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>'

/**
 * 画布节点 → 资源标签。
 *
 * 标记里带 `画布id#节点id`（Node ref 载荷），后端据此引导模型用内置画布 MCP 去查这个节点。
 * onClick（可选）：点标签 = 让画布聚焦到该节点（用户要的「点标签跳到节点」）。
 */
export function nodeResources(
  nodes: CanvasNodeRow[],
  canvasId: string,
  onClick?: (nodeId: string) => void,
): ResourceItem[] {
  return nodes.map((n) => ({
    id: 'node:' + n.id,
    name: n.name || n.id,
    category: '节点',
    value: n.id,
    ref: { kind: 'node', name: n.name || n.id, value: canvasId + '#' + n.id },
    ...(onClick ? { onClick: () => onClick(n.id) } : {}),
    renderItem: () => renderMenuRow(ICON_NODE, n.name || n.id, n.type),
    renderEditor: () => renderTag(ICON_NODE, n.name || n.id),
  }))
}
