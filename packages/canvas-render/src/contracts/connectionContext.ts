/**
 * connectionContext —— "拖线连接过程"反馈状态契约（canvas-render 提供能力、UI 渲染层的读取入口）。
 *
 * 背景：v1 里 BaseNode 的"拖线 3D 倾斜 / 非法连接气泡 / 目标吸附带 / 拖线时压住端口"都靠一个逐帧更新的
 * 响应式 `connectionState` 驱动（谁在拖、悬停到哪个节点、valid/invalid + reason）。canvas-render 作为
 * 渲染宿主层，负责把这个"拖线过程反馈"做成**通用能力**：在 <VueFlow> 上接 @connect-start/@connect-end +
 * #connection-line 插槽，每帧把鼠标位置判定成 hover 反馈并写入本状态；再经 useCanvasRender() 提供给
 * 渲染子树（BaseNode/connection-line 组件等）消费渲染。
 *
 * 坐标系约定：所有坐标一律是 **flow（画布）坐标**（非容器相对像素、非 client 屏幕坐标）。
 * #connection-line 槽 props 的 targetX/Y 就是 flow 坐标，能力层据此计算，无需转。
 *
 * 状态写入方（CanvasHost）：onConnectStart 置 active → #connection-line 渲染时经 rAF 节流写 hoverNode →
 * onConnectEnd / onConnect 清空。写入方只做副作用，不做视觉。
 * 消费方（UI 层 BaseNode/ConnectionLine）：读这些 Ref 决定怎么渲染。
 *
 * 注意：这些字段用 **Ref**（而非 reactive 大对象），形态对齐 edgeSelection（host 整体替换 .value 触发追踪）。
 * 因为在 connection-line 渲染函数里写 reactive 必须 rAF 节流 + 比对变化，否则会 Maximum recursive updates。
 */
import type { Ref } from 'vue'

/** flow 坐标点 */
export interface FlowPoint {
  x: number
  y: number
}

/** 拖线进行中的源端信息 */
export interface ActiveConnection {
  /** 源节点 id */
  sourceNodeId: string
  /** 从哪个 handle 拖出：source=输出口(向右连)，target=输入口(反向向左连) */
  sourceHandle: 'source' | 'target'
}

/** 命中端口所在侧（snap 时）或卡片主体（body 时） */
export type HoverPortSide = 'input' | 'output' | 'body' | null

/**
 * 前端 mouse 事件驱动的"瞄准目标"：拖线时由真实 DOM 的 mouseenter/mouseleave 上报
 * （.moving-handle-zone → side=input/output；.v2-node 卡片 → side=body），后端据此做校验/吸附/落边，
 * 不再用几何坐标重算命中。side 即命中区域类型。
 */
export interface AimedTarget {
  /** 被瞄准的节点 id */
  nodeId: string
  /** 命中区域：input=目标输入口吸附带 / output=目标输出口吸附带 / body=卡片主体 */
  side: 'input' | 'output' | 'body'
  /**
   * 命中吸附带(input/output)时，前端上报的端口锚点 flow 坐标（用真实渲染高度 cardHeight 算，保证居中）。
   * 后端不再拿 dimensions.height 猜，直接用这里给的坐标吸端点。body 命中无需此字段（跟鼠标）。
   */
  anchor?: { x: number; y: number }
}

/** 拖线时悬停到的目标节点反馈（BaseNode 据此做 3D/气泡/吸附带） */
export interface HoverFeedback {
  nodeId: string
  /** 该候选连不连得上 */
  status: 'valid' | 'invalid'
  /** 命中区域：'snap'=端口吸附带内(可吸附对齐)，'body'=落在卡片主体(非端口精确命中) */
  zone: 'snap' | 'body'
  /** 鼠标当前画布坐标（供 BaseNode 定位非法气泡等） */
  flowPosition: FlowPoint
  /** invalid 时给用户看的原因文案（由 InvalidReason 映射成中文，见 connection/reasonText.ts） */
  reason?: string
  /** 命中端口侧：snap 时按方向=input(拖进目标输入)/output(反向拖到源输出)；body 时为 'body'（可空回落） */
  portSide?: HoverPortSide
  /** 命中节点类型 */
  nodeType?: string
  /** 输入口已满额且本次连接会挤最老一条（UI 可选提示"将替换"） */
  willEvict?: boolean
  /** 命中节点数据（宿主 nodeStore 抽出的最小节点对象，非响应式快照） */
  nodeData?: { id: string; type: string; data: Record<string, unknown> } | null
  /** 命中节点对应 DOM 元素（.vue-flow__node，宿主 query；缺省 null） */
  nodeEl?: HTMLElement | null
}

/**
 * 能力层对外暴露的"拖线过程"响应式状态（全是 Ref，host 整体替换触发追踪）。
 * 由 CanvasHost 创建并维护、经 CanvasSurface provide、useCanvasRender().connectionState 读。
 */
export interface ConnectionFeedbackState {
  /** 是否正在拖线（派生：activeConnection 非空） */
  isConnecting: Ref<boolean>
  /** 拖线源端；未拖 = null */
  activeConnection: Ref<ActiveConnection | null>
  /** 当前悬停目标反馈；悬空无目标 = null */
  hoverNode: Ref<HoverFeedback | null>
  /** 前端 mouse 事件上报的当前瞄准目标（拖线时 .moving-handle-zone / 卡片 mouseenter 写入、mouseleave 清空）；
   *  后端 CanvasHost 据此做校验/吸附/落边，不再几何重算命中。 */
  aimedTarget: Ref<AimedTarget | null>
  /** 拖线期间是否压住（非源节点的）浮动端口按钮（v1 suppressHandles 语义） */
  suppressHandles: Ref<boolean>
}
