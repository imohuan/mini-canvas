/**
 * canvasHostCore —— 渲染宿主组件(CanvasHost.vue)的纯逻辑部分，可脱离 DOM / Vue 单测。
 *
 * 职责：把 CanvasDemo.vue 里"store→flow 映射、主题装配、默认外观参数"这几段无副作用逻辑收拢在此，
 * CanvasHost.vue 只做接线(建 host/provide/订阅/事件)。这样核心映射逻辑有单测保护，宿主组件保持薄。
 *
 * 边界：不 import @vue-flow/core，不 import Vue 运行时；类型用最小结构接口避免拉运行时。
 */

import { isTransient, type NodeStoreService, type CanvasNode } from '@mini-canvas/canvas-core-v2'
import type { ThemeRegistry } from '@mini-canvas/canvas-core-v2'
import type { EdgeVisual } from '../contracts/edgeContext'
import type { CanvasParams } from '../contracts/canvasParamKey'
import type { CanvasDebug } from '../contracts/debugContext'
import type { NodeWritePatch } from '../contracts/nodeRegistryKey'

// ============================================================================
// 节点写回 patch 拆分
// ============================================================================

/** 节点写回 patch 的归一结果：data 部分 + 可选正式尺寸 */
export interface NodeWriteSplit {
  /** 写进 node.data 的字段（标题/文本内容/cardWidth…） */
  data: Record<string, unknown>
  /** 保留 key `size` → node.size 正式尺寸字段；patch 未带该 key 时为 undefined */
  size?: { w: number; h: number }
}

/**
 * 把 BaseNode 经 nodeWrite 回传的 patch 拆成 { data, size } 两路。
 *
 * 保留 key `size`：卡片 resize 要把尺寸写进内核的**正式尺寸字段** node.size，而不是塞进 data。
 * 拆出来交给同一次 graph.updateNode 提交，保证「data.cardWidth 与 node.size 同帧、同一条历史」——
 * 否则一次 resize 会记两条撤销记录，且两份尺寸可能不一致。
 *
 * patch 未带 size（如标题就地重命名）→ size 为 undefined，调用方只写 data。
 */
export function splitNodeWritePatch(patch: NodeWritePatch): NodeWriteSplit {
  const { size, ...data } = patch
  return size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }
}

// ============================================================================
// store → VueFlow 渲染态
// ============================================================================

/** VueFlow 消费的节点最小形状（宿主由此驱动渲染；与 nodeStore 节点同构 + 浅拷贝 data） */
export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** 选中态（来自内核 selection；VueFlow 据此高亮节点） */
  selected?: boolean
  /** 父节点 id（内核 CanvasNode.parentId 投影；VueFlow 据此做父子嵌套，子 position 为相对父局部坐标） */
  parentNodeId?: string
  /** 声明尺寸 → 像素 style（内核 CanvasNode.size 投影） */
  style?: { width: string; height: string }
  /** 临时脚手架节点（拖线落空白的菜单节点）：在 VueFlow 维度关闭交互 */
  draggable?: boolean
  selectable?: boolean
  deletable?: boolean
  focusable?: boolean
}

/**
 * 把内核 nodeStore 当前节点灌成 VueFlow 节点数组（data 浅拷贝，避免共享引用被 Vue 改写污染内核）。
 * @param selectedIds 内核选中的节点 id 集（可选）：传入则给匹配节点打 selected=true，驱动 VueFlow 高亮；
 *   不传则不带 selected 字段（向后兼容）。
 */
export function nodesFromStore(store: NodeStoreService, selectedIds?: ReadonlySet<string>): FlowNode[] {
  return store.getNodes().map((n: CanvasNode) => {
    const out: Record<string, unknown> = {
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { ...(n.data as Record<string, unknown>) },
    }
    if (selectedIds) out.selected = selectedIds.has(n.id)
    // —— v2 渲染投影：CanvasNode.parentId/size → VueFlow 父子/尺寸（group 插件依赖）——
    // parentNodeId: VueFlow 把子节点 position 视为相对父的局部坐标（与内核约定一致）
    if (n.parentId) out.parentNodeId = n.parentId
    // size → style 像素尺寸：VueFlow 用它布局父容器/边界；无 size 则交由节点壳自撑
    if (n.size) out.style = { width: n.size.w + 'px', height: n.size.h + 'px' }
    // 中间态节点（如拖线落空白时的菜单卡）—— 必须在 VueFlow 维度隔离：
    //   draggable/selectable/deletable 全关 → pane click 的 removeSelectedElements 摸不到它、
    //   不会拖动、不会进 VueFlow 内部选中集。判定读内核通用契约，不认识具体插件。
    if (isTransient(n)) {
      out.draggable = false
      out.selectable = false
      out.deletable = false
      out.focusable = false
    }
    return out as unknown as FlowNode
  })
}

/** 现有边保留(宿主内维护)；当节点被删时清掉悬挂边 */
export function pruneDanglingEdges<T extends { source: string; target: string }>(
  edges: T[],
  aliveNodeIds: Set<string>,
): T[] {
  return edges.filter((e) => aliveNodeIds.has(e.source) && aliveNodeIds.has(e.target))
}

/** 命中检测用的节点矩形（flow 绝对坐标；由 nodeLayout 实测尺寸给出） */
export interface NodeRectLike {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 松手点是否落在某个节点卡片上（用于区分"落空白"与"落节点上"）。
 *
 * 为什么需要它：拖线松手时"没建成边"有**三种**原因，只有第一种是真空白 ——
 *   ① 落在空白处（真该放临时节点/弹菜单）；
 *   ② 落在节点上但连接不成立（类型不符 / 输入口已满 / 成环 / 重复）；
 *   ③ 落在节点上但方向不符（如从输出口拖到另一个输出口）。
 * 后两种"没建成边"只说明这条连接不合法，落点明明在卡片上，不该冒出"在此处新建节点"的菜单。
 *
 * 为什么用几何命中而不是 elementFromPoint：拖线期间画布挂着 `.connecting` 端口覆盖层，
 * elementFromPoint 命中的是覆盖元素而不是节点卡片（本项目已踩过这个坑）。
 *
 * @param point 松手点（flow 坐标）
 * @param rects 存活节点矩形
 * @returns 命中的节点 id；未命中返回 null（= 真空白）
 */
export function hitNodeIdAt(
  point: { x: number; y: number },
  rects: readonly NodeRectLike[],
): string | null {
  for (const r of rects) {
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return r.id
    }
  }
  return null
}

// ============================================================================
// themeRegistry 装配
// ============================================================================

/** 主题装配结果：宿主拿去填 VueFlow 的 node-types/edge-types + 背景 + 建边默认 type */
export interface ThemeAssembly {
  /** 节点壳组件（nodeShell 槽位；缺省 undefined = 无壳/裸内容） */
  nodeShell: unknown
  /**
   * 每个业务 type 最终用的节点壳（type → 组件）。
   * 解析顺序：`nodeShell:<type>`（该类型自带外壳）→ `nodeShell`（全局默认壳）。
   * 于是某插件想完全自定义自己节点的外观时，注册 `nodeShell:<type>` 即可，不必让默认壳去认识它。
   */
  nodeShells: Record<string, unknown>
  /** 边渲染组件（edge 槽位，放 edgeTypes.custom） */
  edge: unknown
  /** 画布背景组件（background 槽位；缺省 undefined） */
  background: unknown
  /** 拖线临时连接线组件（connectionLine 槽位；缺省 undefined = 宿主回退默认线） */
  connectionLine: unknown
  /** 所有边默认 type 键（edgeDefaultType 槽位；缺省 'custom'） */
  edgeDefaultType: string
  /** 展示注册表里已注册的业务 type 列表（用于铺 nodeTypes 键） */
  nodeTypes: string[]
}

/**
 * 某业务 type 的"专属节点壳"槽名（插件注册它即接管该 type 的整体外观）。
 *
 * 为什么需要：默认壳（如 theme-default 的 BaseNode）提供的是通用卡片外观；
 * 某些节点类型形态特殊（不是"标题+内容"那种卡片），由它自己决定怎么画最合适。
 * 与其让默认壳去猜/认识每个特殊类型，不如让特殊类型自带外壳 —— 默认壳保持通用、零特判。
 */
export function nodeShellSlot(type: string): string {
  return `nodeShell:${type}`
}

/**
 * 从 themeRegistry 读整幅画布渲染所需的外观装配。
 * 节点 type 键来自 nodeStore 已注册类型(经 store 传入)而非 themeRegistry（节点是业务侧注册的）。
 */
export function assembleTheme(
  theme: ThemeRegistry | undefined,
  storeTypes: Iterable<string>,
): ThemeAssembly {
  const shell = theme?.get('nodeShell')
  const edge = theme?.get('edge')
  const background = theme?.get('background')
  const connectionLine = theme?.get('connectionLine')
  const edgeDefaultType =
    (theme?.get('edgeDefaultType') as string | undefined) ?? 'custom'
  const nodeTypes = [...storeTypes]
  // 每 type 解析外壳：自带外壳优先，否则回落到全局默认壳。
  // 这样"特殊形态的节点"由它自己的插件负责长相，默认壳不需要任何针对它的分支。
  const nodeShells: Record<string, unknown> = {}
  for (const t of nodeTypes) {
    const own = theme?.get(nodeShellSlot(t))
    if (own !== undefined) nodeShells[t] = own
    else if (shell !== undefined) nodeShells[t] = shell
  }
  return {
    nodeShell: shell,
    nodeShells,
    edge,
    background,
    connectionLine,
    edgeDefaultType,
    nodeTypes,
  }
}

// ============================================================================
// 默认外观参数（host 未显式传参时的回落；对齐 core-node-contract §0）
// 类型复用 contracts 的 EdgeVisual / CanvasParams（自定义边/端口注入契约），避免重复定义。
// ============================================================================

export const DEFAULT_EDGE_VISUAL: EdgeVisual = {
  edgeType: 'bezier',
  edgeLineWidth: 2,
  edgeColor: '#3b82f6',
  edgeDashed: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeVisible: true,
  edgeVisibleOnSelect: false,
  edgeOnTop: false,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeGlowColor: '#3b82f6',
  // —— 连线新视觉默认（导轨 + 光斑流动；与 plugin-theme-default DEFAULT_THEME_EDGE 对齐）——
  edgeFlowEnabled: true,
  edgeFlowCount: 3,
  edgeFlowRatio: 20,
  edgeFlowSpeed: 1,
  edgeFlowFade: 35,
  edgeFlowIntensity: 0.9,
}

/** 浮动端口外观默认值（对齐 BaseNode DEFAULT_HANDLE / contract §0） */
export const DEFAULT_HANDLE_VISUAL: CanvasParams = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 86,
  portZoneHeightRatio: 0.8,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 1,
}

/** 调试可视化开关默认值（**默认开**：端口调试 + 吸附调试都开，方便设计/排错直观看到端口几何 + 吸附范围） */
export const DEFAULT_DEBUG_VISUAL: CanvasDebug = {
  handleDebug: true,
  connectionSnapDebugVisible: true,
}

/** 给一条源→目标连接生成稳定边 id（与内核 edgeStoreId 四元组语义对齐；无/默认 handle 保持 e-{s}-{t} 兼容）。
 *  B 项：带显式端口时纳入 handle，避免同端点不同端口互相覆盖。 */
export function edgeId(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): string {
  const sh = sourceHandle && sourceHandle !== 'source' ? sourceHandle : ''
  const th = targetHandle && targetHandle !== 'target' ? targetHandle : ''
  if (!sh && !th) return `e-${source}-${target}`
  const srcPart = sh ? `${source}:${sh}` : source
  const tgtPart = th ? `${target}:${th}` : target
  return `e-${srcPart}-${tgtPart}`
}

/** VueFlow 消费的边最小形状（含端口句柄，B 项：多端口边按 handle 匹配端点） */
export interface FlowEdge {
  id: string
  type: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  /** 附加数据（透传给边组件；中间态标记见内核 services/transient.ts） */
  data?: Record<string, unknown>
  /** 中间态边：不可选中/不可删除（VueFlow 侧隔离） */
  selectable?: boolean
  focusable?: boolean
  deletable?: boolean
  zIndex?: number
}

/**
 * 把内核 edgeStore 当前边灌成 VueFlow 边数组，并过滤掉 source/target 已不在存活节点集的悬挂边。
 * B 项：DTO 保留 sourceHandle/targetHandle —— 渲染层能按端口匹配端点，不再丢弃（单端口节点无影响）。
 */
export function edgesFromStore(
  edges: Array<{ id: string; type?: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data?: Record<string, unknown> }>,
  aliveNodeIds: ReadonlySet<string>,
): FlowEdge[] {
  return edges
    .filter((e) => aliveNodeIds.has(e.source) && aliveNodeIds.has(e.target))
    .map((e) => ({
      id: e.id,
      type: e.type ?? 'custom',
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      ...(e.data ? { data: e.data } : {}),
      // 中间态边（拖线占位）—— 同样在 VueFlow 维度隔离：不可选中/不可键盘删除，与正式边视觉共存但语义隔离。
      // 判定读内核通用契约，不认识具体插件。
      ...(isTransient(e)
        ? { selectable: false, focusable: false, deletable: false, zIndex: 1000 }
        : {}),
    }))
}
