import { MemoryStorageAdapter, GRAPH_KEY, GRAPH_EDGES_KEY, scopedKey, type CanvasNode, type CanvasEdge } from '@mini-canvas/canvas-data'

const NODES: CanvasNode[] = [
  { id: 'lab-text', type: 'lab-text', position: { x: 60, y: 84 }, data: { text: '主题改色时，节点壳、端口和连线会一起变。' } },
  { id: 'lab-image', type: 'lab-image', position: { x: 420, y: 60 }, data: { title: '海边房间', subtitle: '示例图片节点' } },
  {
    id: 'lab-warning',
    type: 'lab-warning',
    position: { x: 60, y: 300 },
    data: { tone: 'warning', text: '待确认', description: '检查后才会继续' },
  },
  {
    id: 'lab-danger',
    type: 'lab-danger',
    position: { x: 60, y: 440 },
    data: { tone: 'danger', text: '素材已失效', description: '请重新上传' },
  },
]

const EDGES: CanvasEdge[] = [
  { id: 'lab-edge', source: 'lab-text', target: 'lab-image', sourceHandle: 'source', targetHandle: 'target' },
]

export function newAdapter(): MemoryStorageAdapter {
  const adapter = new MemoryStorageAdapter()
  void adapter.set(scopedKey('canvas', GRAPH_KEY), NODES)
  void adapter.set(scopedKey('canvas', GRAPH_EDGES_KEY), EDGES)
  return adapter
}
