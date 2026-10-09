/**
 * userSegments —— 把用户消息的正文切成「文字片段 / 引用标签片段」（零 Vue、零 DOM，可单测）。
 *
 * 为什么住在这里（从 AgentConversation.vue 抽出来）：
 *   转录里存的是 `<ref … />` **XML 原文**（后端不翻译，见 cloudserve 的 referenceMarkup），
 *   气泡要把它们还原成与输入框同款的标签。这段解析直接决定「点标签会发生什么」——
 *   抽成纯函数才盯得住（此前它埋在 SFC 里，只有源码字面量守卫，测不了行为）。
 *
 * 与 turnBlocks.ts / branchNav.ts 同一种做法：会算东西的都放 .ts，SFC 只渲染。
 */
import { ICON_ASSET, ICON_MCP, ICON_NODE, ICON_SKILL } from './agentResources.js'

export interface UserSegment {
  type: 'text' | 'tag'
  value: string
  name: string
  category: string
  icon: string
  /** 画布节点 id（有它 = 点标签会聚焦到那个节点） */
  nodeId?: string
  /** 引用种类（asset / node / skill / mcp） */
  refType?: string
  /** 资产：本机绝对路径 */
  path?: string
  /** 资产：扩展名（有它 = 单个文件；**目录引用没有它**） */
  ext?: string
  /** 资产：资产库文件夹 id（目录引用必有） */
  folderId?: string
}

const ICON_OF: Record<string, string> = { asset: ICON_ASSET, node: ICON_NODE, skill: ICON_SKILL, mcp: ICON_MCP }
const CATEGORY_OF: Record<string, string> = { asset: '资产', node: '节点', skill: '技能', mcp: 'MCP' }

const REF_RE = /<ref\b[^>]*\/>/g
const ATTR_RE = /(\w+)="([^"]*)"/g

/**
 * 取扩展名（小写、不带点）。
 *
 * 为什么需要：**老转录**里资产引用还没有 `ext` 字段（那时只想让本机 Agent 按 path 读文件），
 * 只有 path。只看 ext 会把一个 .png 当成文件夹（点开变成「打开资产管理」）—— 这里从 path 补一次。
 */
export function extOfPath(path: string | undefined): string {
  if (!path) return ''
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(path.split('?')[0].split('#')[0].trim())
  return m ? m[1].toLowerCase() : ''
}

/** 一段纯文本 → 片段列表（没有引用标记时就是单个文字片段） */
export function parseUserSegments(text: string): UserSegment[] {
  const plain = (value: string): UserSegment => ({ type: 'text', value, name: '', category: '', icon: '' })
  if (!text.includes('<ref ')) return [plain(text)]
  const out: UserSegment[] = []
  const re = new RegExp(REF_RE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(plain(text.slice(last, m.index)))
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    const are = new RegExp(ATTR_RE.source, 'g')
    while ((a = are.exec(m[0])) !== null) attrs[a[1]] = a[2]
    const type = (attrs.type || '').toLowerCase()
    const isAsset = type === 'asset'
    // 有没有 ext 就是「文件 / 目录」的唯一判据，三种情形：
    //   ① 带 ext             → 文件（新数据）
    //   ② 不带 ext 但有 folderId → 目录（新数据；**不能**再拿 path 去推 ext ——
    //      文件夹的 path 是「里面资产的公共目录」，目录名可能带点号（「素材 v1.2」），
    //      推出来会把目录误判成文件、点一下弹图片预览）
    //   ③ 两者都没有          → 老数据（那时只有文件引用）→ 从 path 末尾补一个
    const ext = isAsset ? (attrs.ext || (attrs.folderId ? '' : extOfPath(attrs.path))) : ''
    out.push({
      type: 'tag',
      value: m[0],
      name: attrs.name || '',
      category: CATEGORY_OF[type] ?? '引用',
      icon: ICON_OF[type] ?? ICON_ASSET,
      refType: type,
      ...(type === 'node' && attrs.nodeId ? { nodeId: attrs.nodeId } : {}),
      // 资产要把 path / ext / folderId 带出来：只看名字分不出「文件」还是「文件夹」
      ...(isAsset && attrs.path ? { path: attrs.path } : {}),
      ...(ext ? { ext } : {}),
      ...(isAsset && attrs.folderId ? { folderId: attrs.folderId } : {}),
    })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(plain(text.slice(last)))
  return out
}

/** 这一颗标签点得动吗：节点（聚焦）/ 资产（预览或打开所在文件夹）都点得动 */
export function segClickable(seg: UserSegment): boolean {
  if (seg.nodeId) return true
  return seg.refType === 'asset'
}

/** 悬浮提示：说清「点一下会发生什么」，别让用户猜 */
export function segTitle(seg: UserSegment): string {
  if (seg.refType === 'asset') {
    return seg.category + '：' + seg.name + (seg.ext ? '（点击预览）' : '（点击打开所在文件夹）')
  }
  return seg.category + '：' + seg.name
}

/** 资产标签 → 事件载荷的入参（文件夹只有 folderId；文件有 path + ext） */
export function assetRefInputOf(seg: UserSegment): { name: string; path?: string; ext?: string; folderId?: string } {
  return {
    name: seg.name,
    ...(seg.path ? { path: seg.path } : {}),
    ...(seg.ext ? { ext: seg.ext } : {}),
    ...(seg.folderId ? { folderId: seg.folderId } : {}),
  }
}
