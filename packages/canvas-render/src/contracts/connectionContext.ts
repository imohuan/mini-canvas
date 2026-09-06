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
  /** 拖线期间是否压住（非源节点的）浮动端口按钮（v1 suppressHandles 语义） */
  suppressHandles: Ref<boolean>
}
