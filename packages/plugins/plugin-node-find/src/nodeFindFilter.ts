/**
 * nodeFindFilter —— node-find 搜索/标签/类型元数据纯逻辑（零 Vue、零 DOM，可单测）。
 *
 * v2 数据说明：老版 NodeFindOverlay 依赖 data.nodeType + data.label；v2 节点类型在 node.type，
 * 展示文本分散在各节点 data（text 节点 data.text / image 节点 data.imageUrl / 自定义 data.label）。
 * 这里统一收口成"按 type 取中文名/颜色 + 按节点取展示首行文本"，供浮层与单测共用。
 */
import type { CanvasNode } from '@mini-canvas/canvas-core-v2'

/** 节点类型 → {中文名, 浅色背景, 深色文字}（对齐老版 TYPE_PRESETS，key 改为 node.type） */
export const TYPE_PRESETS: Record<string, { label: string; bg: string; fg: string }> = {
  image: { label: '图片', bg: '#ede9fe', fg: '#6d28d9' }, // violet
  panorama: { label: '全景', bg: '#cffafe', fg: '#0e7490' }, // cyan
  video: { label: '视频', bg: '#fce7f3', fg: '#be185d' }, // pink
  'image-compare': { label: '对比图', bg: '#fef3c7', fg: '#b45309' }, // amber
  group: { label: '分组', bg: '#dbeafe', fg: '#1d4ed8' }, // blue
  text: { label: '文本', bg: '#dcfce7', fg: '#15803d' }, // green
  temp: { label: '临时', bg: '#e5e7eb', fg: '#4b5563' }, // gray
}
export const TYPE_FALLBACK = { label: '自定义', bg: '#f3f4f6', fg: '#6b7280' }

/** 按节点 type 取类型元数据（无预设回退自定义） */
export function typeMeta(type: string): { label: string; bg: string; fg: string } {
  const key = String(type || '').trim()
  return TYPE_PRESETS[key] ?? TYPE_FALLBACK
}

/** 取节点展示首行文本：data.label > data.text 首行 > data.imageUrl 占位 > id */
export function nodeLabelText(node: Pick<CanvasNode, 'id' | 'data'>): string {
  const d = node.data ?? {}
  if (typeof d.label === 'string' && d.label.trim()) return d.label
  if (typeof d.text === 'string' && d.text.trim()) {
    const firstLine = d.text.split(String.fromCharCode(10))[0].trim()
    return firstLine || node.id
  }
  if (typeof d.imageUrl === 'string' && d.imageUrl) return '图片节点'
  return node.id
}

/** 搜索候选过滤（含 temp-target- 隐藏 + 名称/类型/id 匹配）。纯函数便于单测。 */
export function filterNodes(
  nodes: CanvasNode[],
  query: string,
  limit = 20,
): CanvasNode[] {
  const hidden = nodes.filter(
    (n) => !nodeLabelText(n).startsWith('temp-target-') && n.type !== 'temp-target',
  )
  if (!query.trim()) return hidden.slice(0, limit)
  const q = query.toLowerCase().trim()
  return hidden
    .filter((n) => {
      const label = nodeLabelText(n).toLowerCase()
      const type = String(n.type || '').toLowerCase()
      return label.includes(q) || n.id.toLowerCase().includes(q) || type.includes(q)
    })
    .slice(0, limit)
}
