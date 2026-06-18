import type { Connection, Edge, Node } from '@vue-flow/core'

export function normalizeConnection(connection: Connection): Connection {
  return { ...connection, sourceHandle: connection.sourceHandle || 'source', targetHandle: connection.targetHandle || 'target' }
}

export function isValidCanvasConnection(connection: Connection, getNodes: () => Node[], getEdges: () => Edge[]): boolean {
  const normalized = normalizeConnection(connection)
  if (!normalized.source || !normalized.target) return false
  if (normalized.sourceHandle !== 'source') return false
  if (normalized.targetHandle !== 'target') return false
  if (normalized.source === normalized.target) return false

  const source = getNodes().find(node => node.id === normalized.source)
  const target = getNodes().find(node => node.id === normalized.target)
  if (!source || !target) return false
  if (!source.sourcePosition || !target.targetPosition) return false

  return !getEdges().some(edge =>
    edge.source === normalized.source &&
    edge.target === normalized.target &&
    (edge.sourceHandle ?? 'source') === normalized.sourceHandle &&
    (edge.targetHandle ?? 'target') === normalized.targetHandle &&
    !(edge.data as any)?.isTemp
  )
}