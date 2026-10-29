/**
 * useCanvasFlow — 画布基础层
 *
 * 封装 useVueFlow() + store 初始化 + 画布数据持久化。
 */
import { nextTick, shallowRef } from 'vue'
import { useVueFlow, Position } from '@vue-flow/core'
import type { Node, Edge } from '@vue-flow/core'
import { useCanvasStore } from '../composables/useCanvasStore'
import { markRaw } from 'vue'
import BaseNode from '../components/Decoration/BaseNode.vue'
import CustomEdge from '../components/CustomEdge.vue'

const CANVAS_ID = 'main-canvas'
const LS_KEY = 'canvas-data'

const defaultNodes: Node[] = [
  { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: '输入图像' }, sourcePosition: Position.Right },
  { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: '生成图像' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: '生成图像' }, sourcePosition: Position.Right, targetPosition: Position.Left },
]

function makeDefaultEdges() {
  return [
    {
      id: 'e1-2', type: 'custom', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target',
      data: { edgeType: 'bezier', edgeLineWidth: 2, edgeColor: '#3b82f6', edgeDashed: false },
    },
  ] as Edge[]
}

export function useCanvasFlow() {
  const canvas = useCanvasStore()
  const vf = useVueFlow(CANVAS_ID)

  const nodeTypes = shallowRef<Record<string, any>>({ custom: markRaw(BaseNode) })
  const edgeTypes = shallowRef<Record<string, any>>({ custom: markRaw(CustomEdge) })

  let persistReady = false

  function initCanvasData() {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) {
      try {
        const data = JSON.parse(saved)
        vf.fromObject(data)
      } catch (err) {
        console.warn('[Canvas] localStorage 恢复失败', err)
        vf.addNodes(defaultNodes)
        vf.addEdges(makeDefaultEdges())
      }
    } else {
      vf.addNodes(defaultNodes)
      vf.addEdges(makeDefaultEdges())
    }
    nextTick(() => { persistReady = true })
  }

  function persistCanvasData() {
    if (!persistReady) return
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(vf.toObject()))
    } catch { /* quota exceeded, ignore */ }
  }

  function makeEdgeData() {
    const s = canvas.state.core
    return { edgeType: s.edgeType, edgeLineWidth: s.edgeLineWidth, edgeColor: s.edgeColor, edgeDashed: s.edgeDashed }
  }

  return {
    canvas,
    vf,
    canvasId: CANVAS_ID,
    nodeTypes,
    edgeTypes,
    initCanvasData,
    persistCanvasData,
    makeEdgeData,
    connectionLineOptions: {
      style: { stroke: canvas.state.core.edgeColor, strokeWidth: canvas.state.core.edgeLineWidth },
    },
  }
}
