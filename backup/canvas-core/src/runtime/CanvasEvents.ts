import type { EdgeChange, NodeChange } from '@vue-flow/core'
import type { StorageStatus } from '../plugins/storage/StoragePlugin'

export interface CanvasEvents {
  nodesChange: NodeChange[]
  edgesChange: EdgeChange[]
  nodeDragStop: unknown
  connect: unknown
  'storage:status': StorageStatus
  'storage:connected': { workspaceName: string }
  'storage:disconnected': Record<string, never>
  'storage:project-created': unknown
  'storage:project-deleted': unknown
  'storage:project-switched': unknown
  'history:record': unknown
  'history:state-change': { isRestoring: boolean }
  'selection:change': { nodeIds: string[]; edgeIds: string[] }
  'selection:clear': Record<string, never>
  'canvas:setFlag': { key: string; value: unknown }
}