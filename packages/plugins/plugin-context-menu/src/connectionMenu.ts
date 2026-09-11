/**
 * connectionMenu —— "拖线落空白"临时菜单节点的纯逻辑（零 DOM / 零 Vue，可单测）。
 *
 * 定位：临时菜单节点是**真节点**（进 nodeStore/edgeStore，经 VueFlow 渲染），不是自绘浮层。
 * 于是缩放/平移天然对齐，端点和正式连线走同一套渲染。
 * 靠内核通用契约标 `transient` 把它与正式图隔离：
 *   - 渲染层：draggable/selectable/deletable 全关（canvasHostCore.nodesFromStore/edgesFromStore）；
 *   - 历史/落盘：createMiniCanvasHost 的 snapshot/commit 过滤中间态（不入撤销栈、刷新不复活）。
 *
 * 核心不变量（用户明确要求）：**鼠标松手点 = 新节点连接端口的位置**。
 *   - 从输出口拖出（新节点是 target）→ 新节点**输入口在左缘**，卡片左缘中点落在松手点；
 *   - 从输入口反向拖出（新节点是 source）→ 新节点输出口在右缘，卡片右缘中点落在松手点。
 * 临时卡片与创建出的真节点用**同一个** placeByPortAnchor，所以点菜单项时端口不跳位。
 */
import {
  isTransient,
  validateConnection,
  type ExistingEdge,
  type NodeConnectionDef,
} from '@mini-canvas/canvas-core-v2'
import type { ContextMenuItem, MenuNodeTypeLike } from './menuBuilder'

/** 临时菜单节点的节点类型名（本插件经 ctx.nodes.register 注册，带菜单卡片 content） */
export const CONNECTION_MENU_TYPE = 'connection-menu'
/** 卡片里点了某项 → 广播给插件（插件据此建真节点 + 真边） */
export const CONNECTION_MENU_PICK_EVENT = 'canvas:connection-menu:pick'
/** 请求取消（点画布空白 / Esc） */
export const CONNECTION_MENU_CANCEL_EVENT = 'canvas:connection-menu:cancel'

/** 卡片宽度（画布单位）：右键菜单 min-width 252 + 两侧 6px 内边距 */
export const CARD_WIDTH = 264
/** 单项高度：右键菜单 .ctx-menu-item 的 min-height 44px */
export const ITEM_HEIGHT = 44
/** 卡片上下内边距合计（padding 6px × 2） */
export const CARD_PADDING_Y = 12
/** 卡片边框（1px × 2）；box-sizing:border-box 下必须计入高度，否则行被挤 2px */
export const CARD_BORDER = 1

/** 用内核校验预筛候选类型时的"待建节点"占位 id（只活在判定里，不落任何 store） */
export const PENDING_NODE_ID = '__connection-menu-new__'

/** 拖线生效的最小拖拽距离（屏幕 px）默认值；可在 ⚙ 设置面板改（Config.dragThreshold）。 */
export const DEFAULT_DRAG_THRESHOLD = 6

/** 松手事实：源节点、起点端口、落点（flow 画布坐标） */
export interface ConnectionDropFact {
  /** 拖线源节点 id */
  sourceNodeId: string
  /** 起点端口：'source' = 从输出口拖出；'target' = 从输入口反向拖出 */
  sourceHandle: 'source' | 'target'
  /** 松手点画布坐标（= 新节点连接端口的位置） */
  flowPosition: { x: number; y: number }
}

/** 尺寸 / 点（画布单位） */
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

/** 一条连线的端点（canonical：source 端在 source 节点、target 端在 target 节点） */
export interface EdgeEndpoints {
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

/**
 * 是否临时脚手架节点（拖线落空白的菜单节点）。
 *
 * 判定走内核通用契约 `isTransient`（不落盘/不进历史/不可交互），本插件不自己发明标记。
 */
export function isTempNode(node: { data?: Record<string, unknown> } | undefined): boolean {
  return isTransient(node)
}

/** 是否临时脚手架边（占位连线）。判定同上，走内核通用契约。 */
export function isTempEdge(edge: { data?: Record<string, unknown> } | undefined): boolean {
  return isTransient(edge)
}

/** 屏幕点 */
export interface ScreenPoint {
  x: number
  y: number
}

/**
 * 这次拖线手势是否"真的在拖"：鼠标按下点与当前位置的距离 ≥ 阈值。
 *
 * 为什么要它：从端口**单击**（按下就松开、没移动）不应该被当成"拖线到空白"，
 * 否则在端口上点一下就会冒出一个菜单节点。阈值可在设置面板配置（屏幕 px，不随画布缩放变）。
 */
export function isDragBeyondThreshold(
  start: ScreenPoint | null,
  current: ScreenPoint,
  threshold: number,
): boolean {
  if (!start) return false
  const dx = current.x - start.x
  const dy = current.y - start.y
  const t = Math.max(threshold, 0)
  return Math.hypot(dx, dy) >= t
}

/**
 * **先建节点、等它就绪、再连边** —— 这条时序是硬要求，不是风格问题。
 *
 * 原因：VueFlow 消费 `edges` prop 时会对每条边调 `findNode(edge.source/target)`，
 * 两端节点不在它的内部 store 里就**直接丢弃这条边**（EDGE_SOURCE_TARGET_MISSING）。
 * 而 nodes / edges 是两个独立的 watcher，同帧写入时边可能先于节点落地 → 线画不出来
 *（v1 老版同样是在建完节点后 `await nextTick()` 再补边）。
 *
 * 这里不靠"猜一帧"：轮询 `isNodeReady`（调用方用渲染层实测尺寸判断节点确已进 VueFlow 内部 store）
 * 直到就绪或重试用尽。这样即使某次渲染更慢也不会丢线。
 *
 * 各回调由调用方注入，便于单测钉住这条契约。
 */
export async function addEdgeWhenNodeReady(input: {
  /** 等一帧（浏览器传 Vue 的 nextTick） */
  waitTick: () => Promise<unknown>
  /** 节点是否已就绪（渲染层实测到尺寸 = 确已进 VueFlow 内部 store） */
  isNodeReady: () => boolean
  /** 节点是否还在（可能已被取消/撤销） */
  isAlive: () => boolean
  /** 真正连边，返回边 id（不该连时返回 null） */
  addEdge: () => string | null
  /** 最大重试帧数（缺省 20 帧 ≈ 0.3s，足够覆盖首帧渲染） */
  maxTries?: number
}): Promise<string | null> {
  const maxTries = input.maxTries ?? 20
  for (let i = 0; i < maxTries; i += 1) {
    await input.waitTick()
    if (!input.isAlive()) return null
    if (input.isNodeReady()) return input.addEdge()
  }
  // 重试用尽：仍然尝试一次（若节点其实已就绪、只是量测没触发，这样也不会白丢一条线；
  // 若节点确实还没进 VueFlow store，这条边会被它按 EDGE_SOURCE_TARGET_MISSING 丢掉，无副作用）。
  if (!input.isAlive()) return null
  return input.addEdge()
}

/**
 * 临时菜单卡片尺寸（画布单位）：宽固定，高 = 内边距 + 边框 + 项数×行高。
 * 与卡片 CSS 严格对应，故卡片左/右缘竖直中点（端口锚点）精确 —— 这是"不手算渲染高度"的正解：
 * 自己声明盒子尺寸并让内容按 border-box 填满，而不是去猜渲染出来的高度。
 */
export function connectionMenuCardSize(itemCount: number): Size {
  return {
    w: CARD_WIDTH,
    h: CARD_PADDING_Y + 2 * CARD_BORDER + Math.max(itemCount, 1) * ITEM_HEIGHT,
  }
}

/** 连接端口在卡片哪条竖直边：从输出口拖出→新节点输入口在左；反向→输出口在右 */
export function portSideOf(fact: ConnectionDropFact): 'left' | 'right' {
  return fact.sourceHandle === 'target' ? 'right' : 'left'
}

/**
 * 按"端口锚点"摆放节点：让盒子指定侧**竖直中点**正好落在锚点上（节点 position 是左上角）。
 * 临时卡片与创建出的真节点共用此函数 → 端口位置在两者间保持不变。
 */
export function placeByPortAnchor(anchor: Point, size: Size, side: 'left' | 'right'): Point {
  return {
    x: side === 'right' ? anchor.x - size.w : anchor.x,
    y: anchor.y - size.h / 2,
  }
}

/**
 * 解析连线端点：**新节点永远当"新节点"**——
 * - 从输出口(source)拖出 → 源节点 → 新节点：source=源节点/source，target=新节点/target；
 * - 从输入口(target)反向拖出 → 新节点 → 源节点：source=新节点/source，target=源节点/target。
 *
 * @param newNodeId 新节点 id（临时态传临时 id，落定态传真节点 id —— 规则只此一处）
 */
export function resolveEdgeEndpoints(fact: ConnectionDropFact, newNodeId: string): EdgeEndpoints {
  if (fact.sourceHandle === 'target') {
    return { source: newNodeId, target: fact.sourceNodeId, sourceHandle: 'source', targetHandle: 'target' }
  }
  return { source: fact.sourceNodeId, target: newNodeId, sourceHandle: 'source', targetHandle: 'target' }
}

/**
 * 组装"引用该节点生成"菜单项 = 可建节点类型清单。
 * 只放"新建节点"区（与右键 pane 菜单的添加节点区同款外观），不掺删除/复制等无关命令。
 * icon/description 由 menuEnrich.enrichMenuItems 在插件层补齐（与右键菜单同源）。
 */
export function buildConnectionMenuItems(types: readonly MenuNodeTypeLike[]): ContextMenuItem[] {
  return types.map((t, index) => ({
    id: 'create-node:' + t.type,
    label: t.label,
    group: 'create',
    order: index,
    kind: 'create-node' as const,
    nodeType: t.type,
  }))
}

/**
 * 用内核 validateConnection 预筛可建类型：把"待建节点"当占位节点塞进节点表，
 * 按拖出方向拼候选端点，跑一遍与正式建边**同一套**规则（方向/内容类型/accepts/容量/环/重复）。
 * 这样卡片不会列出"点了必然失败"的类型。
 */
export function filterConnectableTypes(input: {
  fact: ConnectionDropFact
  sourceNodeType: string | undefined
  types: readonly MenuNodeTypeLike[]
  edges: readonly ExistingEdge[]
  getTypeConn: (type: string) => NodeConnectionDef | undefined
}): MenuNodeTypeLike[] {
  const { fact, sourceNodeType, types, edges, getTypeConn } = input
  const reverse = fact.sourceHandle === 'target'
  return types.filter((candidate) => {
    const nodes = new Map<string, { id: string; type: string }>([
      [fact.sourceNodeId, { id: fact.sourceNodeId, type: sourceNodeType ?? '' }],
      [PENDING_NODE_ID, { id: PENDING_NODE_ID, type: candidate.type }],
    ])
    const conn = reverse
      ? { source: PENDING_NODE_ID, target: fact.sourceNodeId }
      : { source: fact.sourceNodeId, target: PENDING_NODE_ID }
    return validateConnection(conn, { nodes, edges: [...edges], getTypeConn }).ok
  })
}
