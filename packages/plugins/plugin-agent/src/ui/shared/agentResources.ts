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
import { REF_ICONS, REF_KIND_ICONS, type ResourceItem } from 'prosemirror-editor-bundle'
import type { McpRow, SkillRow } from '../../service/agentService.js'
import { mediaKindOfExt } from './agentChipThumbs.js'

/** 技能图标（魔杖 + 星光）：与工具栏上的技能按钮同源 */
export const ICON_SKILL = REF_ICONS.skill

/** MCP 图标（插头）：与工具栏上的 MCP 按钮同源 */
export const ICON_MCP = REF_ICONS.mcp

/**
 * 标签左侧那格：有缩略图就画图（下面垫着类型图标，图没出来时露出来）。
 *
 * 用户口径 2026-11-06：节点 / 资产的标签要能看出内容，不再一律是类型图标。
 * 为什么图垫在图标上而不是替换：图可能 404 / 还没取到视频首帧，
 * 只画图时那一下就剩空白；垫着图标则永远有个能认的标识。
 *
 * 为什么用背景图层而不是 <img>：编辑器会给标签里每个 <img> 套上它自己的
 * 缩略加载器（按 resourceItem.url 重设 src，失败就 display:none），
 * 那会把手上的图换成 mp4 再隐藏掉。背景图不过那条路，加载失败也只是透明。
 */
function iconSpan(svg: string, thumb?: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'ac-tag-icon'
  el.innerHTML = svg
  if (thumb) {
    const layer = document.createElement('span')
    layer.className = 'ac-tag-thumb'
    // 用 style 赋值而不是拼 HTML：data URL / 带引号的地址不会被拼串拼坏
    layer.style.backgroundImage = 'url("' + thumb.replace(/["\\]/g, '\\$&') + '")'
    el.append(layer)
  }
  return el
}

/** ProseMirror 造标签时调的工厂：渲染成「[图标] 标题」 */
function renderTag(svg: string, label: string, thumb?: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'ac-tag'
  // 名字超长时标签会被样式截断（.ac-tag 有限宽），全名靠 title 补回来：
  // 悬停能看全，也不影响点击行为。
  el.title = label
  const lb = document.createElement('span')
  lb.className = 'ac-tag-label'
  lb.textContent = label
  el.append(iconSpan(svg, thumb), lb)
  return el
}

/**
 * @ 菜单里的那一行：图标格 + 标题 + 次要说明（与插入后的标签同款图标）。
 *
 * 有缩略图时把图铺在同一格里（用户 2026-11-06：@ 菜单里的节点也要能看出内容）。
 * 用背景图层、不用 <img>：与标签那一格同一条理由（失败也只是透明，露出类型图标）。
 */
function renderMenuRow(svg: string, name: string, hint: string, thumb?: string): VNode {
  return h('span', { class: 'ac-mrow' }, [
    h('span', { class: 'ac-mrow-icon' }, [
      // 图标单独一层：Vue 不允许同一个元素既给 innerHTML 又给子节点
      h('span', { class: 'ac-mrow-glyph', innerHTML: svg }),
      thumb
        ? h('span', {
          class: 'ac-mrow-thumb',
          style: { backgroundImage: 'url("' + thumb.replace(/["\\]/g, '\\$&') + '")' },
        })
        : null,
    ]),
    h('span', { class: 'ac-mrow-text' }, [
      h('span', { class: 'ac-mrow-name' }, name),
      hint ? h('span', { class: 'ac-mrow-hint' }, hint) : null,
    ]),
  ])
}

/** 已装技能 → 资源标签（名字就是触发关键词，@ 或直接点列表插入） */
/** 资产图标（图片） */
export const ICON_ASSET = REF_ICONS.asset

/** 内容类型图标（图片 / 视频 / 音频 / 文本）—— 标签图标的第二轮兜底 */
export const ICON_KIND = REF_KIND_ICONS

/** 认得出的内容类型（与底栏的 chipKind 同一套） */
export type RefKindIcon = keyof typeof REF_KIND_ICONS

/**
 * 标签左侧图标的取法（用户 2026-11-11，按顺序三轮）：
 *   ① **真实图标**：节点类型注册时声明的 icon（音频节点就是音波，图片节点就是图片框）；
 *   ② **类型图标**：拿不到真实图标时，按 image / video / audio / text 画对应图标；
 *   ③ **默认图标**：类型也认不出，才用「节点 / 资产」的通用图标。
 *
 * 为什么必须是这个顺序：以前节点一律画通用方块、资产一律画图片，
 * 用户截图里「音频节点显示图片图标」「图片节点显示一块面板」都是少了前两轮。
 * icon 是 opaque 句柄（SVG 字符串或组件）：字符串直接用；组件没有 SVG 串可用，
 * 这里退回类型图标 —— 标签是由 ProseMirror 直接造 DOM 的，挂不了 Vue 组件。
 */
export function resolveRefIcon(
  kind: string | undefined,
  ownIcon: unknown,
  fallback: string,
): string {
  if (typeof ownIcon === 'string' && ownIcon.trim()) return ownIcon
  const k = String(kind ?? '')
  if (k === 'image' || k === 'video' || k === 'audio' || k === 'text') return REF_KIND_ICONS[k]
  return fallback
}

/** 资产引用要用的三样东西：本地路径 / 扩展名 / 所属资产库文件夹 id */
export interface AssetRefInput {
  id?: string
  name: string
  url: string
  path?: string
  folderId?: string
  /** 直接可用的缩略图地址（图片 = 自身地址；视频 = 已取到的首帧） */
  thumb?: string
  /**
   * 这是一条**资产库文件夹**引用（不是文件）。
   *
   * 为什么必须显式标：文件夹的 path 是「里面资产的公共目录」，而目录名可能带点号
   * （「素材 v1.2」）—— 光看扩展名会把文件夹误判成文件，点一下变成弹图片预览。
   */
  isFolder?: boolean
  /**
   * 资产类型（image / video / audio）。
   *
   * 为什么不能只靠扩展名：资产名可能是 UUID（截图里的 d4b974cd-44c5-…），
   * 没有扩展名就认不出是音频，标签会退回图片图标。
   */
  kind?: string
}

/** 点标签时广播出去的形状：与 `<ref type="asset" … />` 的属性一一对应 */
export interface AssetRefOpen {
  name: string
  path?: string
  ext?: string
  folderId?: string
}

/**
 * 从路径 / 地址 / 文件名里取扩展名（小写、不带点）。取不到返回空串。
 *
 * 为什么要三处都试：资产行给的是 url（`/api/assets/files/ab12.png`），拖拽/引用的老入口
 * 可能只给 name，而 path 是后端惰性迁移补上的、可能缺。
 */
export function assetExtOf(a: { path?: string; url?: string; name?: string }): string {
  for (const s of [a.path, a.url, a.name]) {
    if (!s) continue
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(s).split('?')[0].split('#')[0].trim())
    if (m) return m[1].toLowerCase()
  }
  return ''
}

/**
 * 一份**资产**（左侧资产面板里的图/视频/音频）→ 资源标签。
 * 走与技能/MCP 同一条插入通道：服务把待插项放进 state，输入框组件插成 chip。
 *
 * 标记里带的是**本机绝对路径**（asset.path），不是 HTTP 地址 ——
 * 与技能引用给 SKILL.md 绝对路径同一条规矩：引用要能复制到本机 Agent（Codex 等）直接用，
 * 给 URL 的话对方还得猜 base、下载，绕好几步。没有 path 的资产不会走到这里（入口不显示）。
 *
 * 另外带两个**给前端自己用**的字段（2026-10-08 用户口径：引用标签要能点开看东西）：
 *   ext      扩展名 —— 点标签时按它挑预览器（图片/视频/音频/文本）；
 *   folderId 资产库文件夹 id —— 点**文件夹**标签时定位到资产管理的那一层。
 */
export function assetResource(asset: AssetRefInput, onOpen?: (ref: AssetRefOpen) => void): ResourceItem {
  // 文件夹不取扩展名（见 AssetRefInput.isFolder 的说明）——「没有 ext」就是给读的人看的「这是目录」
  const ext = asset.isFolder ? '' : assetExtOf(asset)
  // 文件夹没有内容可缩略；图片直接用自己的地址，视频用调用方取好的首帧。
  // 资产清单给的类型优先，但只认三种内容类型：'other' / 'node-package' 不能盖掉扩展名
  // （否则一张 png 会因为没有可认的类型而退回默认图标）。
  const declared = asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio' ? asset.kind : ''
  const kind = declared || mediaKindOfExt(ext)
  const thumb = asset.isFolder ? '' : asset.thumb || (kind === 'image' ? asset.url : '')
  /**
   * 图标三轮（用户 2026-11-11）：资产没有「类型注册的 icon」这一份，
   * 所以第一轮跳过，直接按类型画；认不出类型（folder / other）才用资产默认图标。
   * 以前资产一律画图片图标 —— 音频资产显示成一张图片就是这里。
   */
  const icon = resolveRefIcon(kind, undefined, ICON_ASSET)
  const open: AssetRefOpen = {
    name: asset.name,
    ...(asset.path ? { path: asset.path } : {}),
    ...(ext ? { ext } : {}),
    ...(asset.folderId ? { folderId: asset.folderId } : {}),
  }
  return {
    id: 'asset:' + (asset.id ?? asset.url),
    name: asset.name,
    category: '资产',
    value: asset.path || asset.url,
    ...(thumb ? { thumbnail_url: thumb } : {}),
    ...(!asset.isFolder && (kind === 'image' || kind === 'video' || kind === 'audio')
      ? { chipKind: kind }
      : {}),
    ref: {
      kind: 'asset',
      name: asset.name,
      value: asset.path || asset.url,
      ...(ext ? { ext } : {}),
      ...(asset.folderId ? { folderId: asset.folderId } : {}),
    },
    renderItem: () => renderMenuRow(icon, asset.name, '资产', thumb),
    renderEditor: () => renderTag(icon, asset.name, thumb),
    // 点输入框里这颗 chip = 与点对话气泡里的标签同一件事（预览 / 打开所在文件夹）。
    // 不传 onOpen（纯展示场景）就不带点击行为 —— 与技能 / MCP 标签一致。
    ...(onOpen ? { onClick: () => onOpen(open) } : {}),
  }
}

/**
 * 批量版 assetResource：多选工具栏「加入资产库」一次插多张图。
 * 每一项与单张完全同形（同一渲染器、同一载荷口径），只是数量 N。
 */
export function assetResources(assets: AssetRefInput[], onOpen?: (ref: AssetRefOpen) => void): ResourceItem[] {
  return assets.map((a) => assetResource(a, onOpen))
}

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
 * 单个 MCP 工具 → 资源标签。
 *
 * name 用 `服务.工具` —— 后端 `namesOfKind(text,'mcp')` 拿到这份 name 后只取第一段当服务名
 * （工具名对 system_config 无意义，连上服务才是真开关；工具全名模型从标记的 value 里读）。
 * value 放 SDK 的全名 `mcp__服务__工具`：模型拿到标记就知道该调哪一个。
 */
export function mcpToolResource(server: string, toolName: string, description: string): ResourceItem {
  const fullName = 'mcp__' + server + '__' + toolName
  return {
    id: 'mcp-tool:' + fullName,
    name: server + '.' + toolName,
    category: 'MCP',
    value: fullName,
    ref: { kind: 'mcp', name: server + '.' + toolName, value: fullName },
    renderItem: () => renderMenuRow(ICON_MCP, server + '.' + toolName, description),
    renderEditor: () => renderTag(ICON_MCP, server + '.' + toolName),
  }
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
  /** 节点类型或 data.nodeType 归一后的值（image / video / audio / text …） */
  kind?: string
  /** 能直接塞进 <img> 的缩略图（图片节点：图片地址；视频节点：已取到的首帧） */
  thumb?: string
  /**
   * 节点类型注册时声明的**真实图标**（opaque 句柄，通常是 SVG 字符串）。
   * 标签图标第一轮用它；拿不到才按 kind 兜底（见 resolveRefIcon）。
   */
  icon?: unknown
}

/** 节点图标（按类型粗分；装饰用，认不出就当通用节点） */
export const ICON_NODE = REF_ICONS.node

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
  return nodes.map((n) => {
    /**
     * 图标三轮（用户 2026-11-11）：节点类型自己的 icon 优先；
     * 没有就按类型（image / video / audio / text）；最后才用节点默认图标。
     */
    const icon = resolveRefIcon(n.kind, n.icon, ICON_NODE)
    return {
      id: 'node:' + n.id,
      name: n.name || n.id,
      category: '节点',
      value: n.id,
      ...(n.kind === 'image' || n.kind === 'video' || n.kind === 'audio' || n.kind === 'text'
        ? { chipKind: n.kind }
        : {}),
      ...(n.thumb ? { thumbnail_url: n.thumb } : {}),
      ref: { kind: 'node', name: n.name || n.id, value: canvasId + '#' + n.id },
      ...(onClick ? { onClick: () => onClick(n.id) } : {}),
      renderItem: () => renderMenuRow(icon, n.name || n.id, n.type, n.thumb),
      renderEditor: () => renderTag(icon, n.name || n.id, n.thumb),
    }
  })
}
