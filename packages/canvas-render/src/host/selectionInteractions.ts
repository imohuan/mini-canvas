/**
 * selectionInteractions —— 画布点选/框选交互的纯逻辑（canvas-render 能力层，可脱离 DOM 单测）。
 *
 * 背景：CanvasHost 里 onNodeClick/onEdgeClick/onPaneClick 的选中语义（Shift 加选/普通单选/清空）
 * 是画布交互的核心行为，不应只活在 .vue 组件里；抽成纯函数后宿主直接调用，测试锁定行为。
 *
 * 语义约定（对齐内核 Selection v2 双集：ids=节点、edgeIds=边）：
 *  - 普通点选节点：清边选中 → 节点单选
 *  - Shift+点选节点：切换该节点选中（加/减），边选中不动
 *  - 普通点选边：清节点选中 → 边单选
 *  - Shift+点选边：切换该边选中（加/减），节点选中不动
 *  - 点画布空白：节点与边一起清空
 */
import type { SelectionService } from '@mini-canvas/canvas-data'

export interface SelectionClickOptions {
  /** 是否按住 Shift（多选修饰键） */
  shiftKey?: boolean
}

/** 点选一个节点。返回是否发生了选中变化。 */
export function clickNode(sel: SelectionService, nodeId: string, opts: SelectionClickOptions = {}): boolean {
  if (opts.shiftKey) {
    if (sel.has(nodeId)) {
      sel.remove(nodeId)
      return true
    }
    sel.add(nodeId)
    return true
  }
  sel.clearEdges()
  const changed = !sel.has(nodeId) || sel.edgeIds.size > 0 || sel.ids.size !== 1
  sel.set(new Set([nodeId]))
  return changed
}

/** 点选一条边。返回是否发生了选中变化。 */
export function clickEdge(sel: SelectionService, edgeId: string, opts: SelectionClickOptions = {}): boolean {
  if (opts.shiftKey) {
    if (sel.hasEdge(edgeId)) {
      sel.removeEdge(edgeId)
      return true
    }
    sel.addEdge(edgeId)
    return true
  }
  sel.clearNodes()
  const changed = !sel.hasEdge(edgeId) || sel.ids.size > 0 || sel.edgeIds.size !== 1
  sel.setEdges(new Set([edgeId]))
  return changed
}

/** 点画布空白：清空节点与边选中。返回是否原本有选中。 */
export function clickPane(sel: SelectionService): boolean {
  const had = sel.ids.size > 0 || sel.edgeIds.size > 0
  if (had) sel.clear()
  return had
}

/**
 * 拖拽起点的「拖拽选中」：拖动一个未选中的节点时顺手选中它（对齐 VueFlow selectNodesOnDrag 语义）。
 *
 * 为什么需要显式这一步：v2 选中单源在内核 Selection，VueFlow 内部的 select-on-drag 不回写内核，
 * 渲染高亮由内核投影驱动 → 内部选中会被随后的投影覆盖，表现为"开了也没效果"。
 * 宿主在 onNodeDragStart 调本函数把选中写进内核。
 *
 * 语义（对齐 VueFlow handleNodeClick 非多选分支）：
 * - 开关关 / 元素不可选中 → 不动；
 * - 节点已在选中集（含多选拖动整组）→ 保持现状（不动，避免把整组缩成单选）；
 * - 否则 → 单选该节点（替换原选中）。
 * 返回是否发生了选中变化。
 */
export function dragSelectNode(
  sel: SelectionService,
  nodeId: string,
  opts: { enabled: boolean; selectable: boolean },
): boolean {
  if (!opts.enabled || !opts.selectable) return false
  if (sel.has(nodeId)) return false
  sel.set(new Set([nodeId]))
  return true
}
