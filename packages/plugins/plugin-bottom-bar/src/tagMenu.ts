/**
 * 标签菜单（图 4 风格）的**纯逻辑**：把画布节点分组成「已引用 / 素材引用（按类型）」。
 *
 * 用户 2026-10-29 定案：
 *   · 数据源 = **整个画布**（不是当前连线）；
 *   · 分组：已引用（本节点已经连进来的）在上，其余按 图片 / 视频 / 音频 / 文本 分组；
 *   · 搜索同时匹配名称与 id；
 *   · 排序：组内按名称自然序（与图 4 一致），已引用组保持画布顺序。
 */
export type TagMenuKind = 'image' | 'video' | 'audio' | 'text'

export interface TagMenuEntry {
  id: string
  name: string
  kind: TagMenuKind
  url?: string
  /** 本节点已经连了这个节点（菜单里显示在「已引用」并在行尾给勾） */
  referenced: boolean
}

export interface TagMenuGroup {
  kind: TagMenuKind | 'referenced'
  label: string
  items: TagMenuEntry[]
}

const KIND_LABEL: Record<TagMenuKind, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }
const KIND_ORDER: TagMenuKind[] = ['image', 'video', 'audio', 'text']

/** 自然序比较：'图片2' 排在 '图片10' 前面（用户 2026-10-29 口述的菜单顺序） */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

export function buildTagMenuGroups(entries: ReadonlyArray<TagMenuEntry>, query: string): TagMenuGroup[] {
  const q = query.trim().toLowerCase()
  const matched = entries.filter((e) => !q
    || e.name.toLowerCase().includes(q)
    || e.id.toLowerCase().includes(q))
  const groups: TagMenuGroup[] = []
  const referenced = matched.filter((e) => e.referenced)
  if (referenced.length > 0) {
    groups.push({ kind: 'referenced', label: '已引用', items: referenced })
  }
  for (const kind of KIND_ORDER) {
    const items = matched
      .filter((e) => e.kind === kind && !e.referenced)
      .sort((a, b) => naturalCompare(a.name, b.name))
    if (items.length > 0) groups.push({ kind, label: KIND_LABEL[kind], items })
  }
  return groups
}

/** 某个节点在菜单里能不能点选（已在「已引用」组里的仍可点：等于聚焦到它） */
export function isTagMenuEntrySelectable(entry: TagMenuEntry): boolean {
  return Boolean(entry.id)
}

