export type GroupColorSwatch =
  | { kind: 'preset'; id: string; color: string; label: string }
  | { kind: 'custom'; id: 'custom'; label: string }

export interface DownloadableGroupChild<TNode = unknown> {
  node: TNode
  commandId: string
}

type NodeLike = {
  id?: string
  type?: string
  parentNode?: string
  data?: { nodeType?: string }
}

export const GROUP_COLOR_SWATCHES: GroupColorSwatch[] = [
  { kind: 'preset', id: 'blue', color: '#0ea5e9', label: '蓝色' },
  { kind: 'preset', id: 'slate', color: '#334155', label: '石板灰' },
  { kind: 'preset', id: 'red', color: '#ef4444', label: '红色' },
  { kind: 'preset', id: 'orange', color: '#f97316', label: '橙色' },
  { kind: 'preset', id: 'yellow', color: '#eab308', label: '黄色' },
  { kind: 'preset', id: 'green', color: '#22c55e', label: '绿色' },
  { kind: 'preset', id: 'violet', color: '#6366f1', label: '紫色' },
  { kind: 'custom', id: 'custom', label: '自定义' },
]

export const DEFAULT_GROUP_BACKGROUND_COLOR = GROUP_COLOR_SWATCHES[0].kind === 'preset'
  ? GROUP_COLOR_SWATCHES[0].color
  : '#0ea5e9'

export function resolveGroupBackgroundColor(color: unknown): string {
  return typeof color === 'string' && color.trim() ? color : DEFAULT_GROUP_BACKGROUND_COLOR
}

export function normalizeGroupTitle(title: unknown): string {
  return typeof title === 'string' ? title.trim() : ''
}

export function getNodeType(node: NodeLike): string {
  return node.data?.nodeType || node.type || ''
}

export function getDownloadCommandId(node: NodeLike, hasCommand: (commandId: string) => boolean): string | null {
  const type = getNodeType(node)
  const commandId = `${type}.download`
  return type && hasCommand(commandId) ? commandId : null
}

export function selectDownloadableGroupChildren<TNode extends NodeLike>(
  nodes: TNode[],
  groupId: string,
  hasCommand: (commandId: string) => boolean,
): DownloadableGroupChild<TNode>[] {
  return nodes.flatMap((node) => {
    if (node.parentNode !== groupId) return []
    const commandId = getDownloadCommandId(node, hasCommand)
    return commandId ? [{ node, commandId }] : []
  })
}