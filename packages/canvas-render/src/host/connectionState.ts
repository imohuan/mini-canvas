/**
 * host/connectionState.ts —— 拖线反馈状态的工厂 + 生命周期 handler 签名（CanvasHost 使用）。
 *
 * 能力层把"拖线过程"状态做成可注入的响应式对象：CanvasHost 建一份(createConnectionState)，
 * onConnectStart/onConnectEnd 写入，CanvasSurface 把同一引用经 renderContext provide；
 * 每帧 hover 由 #connection-line 里的 ConnectionLineHost 经 resolveFeedback + rAF 节流写入。
 *
 * 纯工厂（只依赖 vue ref/computed），可脱离 .vue 单测；副作用 handler 留在 CanvasHost.vue。
 */
import { ref, computed } from 'vue'
import type {
  ConnectionFeedbackState,
  ActiveConnection,
  HoverFeedback,
  DropSnapshot,
} from '../contracts/connectionContext'

/** 建一份可注入的默认连接反馈状态 */
export function createConnectionState(): ConnectionFeedbackState {
  const activeConnection = ref<ActiveConnection | null>(null)
  const hoverNode = ref<HoverFeedback | null>(null)
  const suppressHandles = ref(false)
  const lastDrop = ref<DropSnapshot | null>(null)
  const isConnecting = computed(() => activeConnection.value !== null)
  return {
    isConnecting,
    activeConnection,
    hoverNode,
    suppressHandles,
    lastDrop,
  }
}

/** 开始拖线：记录源 + 压端口 + 清反馈（lastDrop 不清，留给 connect-end 决策建边） */
export function beginConnection(
  state: ConnectionFeedbackState,
  active: ActiveConnection,
): void {
  state.activeConnection.value = active
  state.suppressHandles.value = true
  state.hoverNode.value = null
  state.lastDrop.value = null
}

/**
 * 结束拖线（connect-end / connect 兜底）：清空悬停/压端口。**不**清 lastDrop——
 * 由 CanvasHost.onConnectEnd 先读 lastDrop 判 body/吸附带建边，再自行置空。
 */
export function endConnection(state: ConnectionFeedbackState): void {
  state.activeConnection.value = null
  state.suppressHandles.value = false
  state.hoverNode.value = null
}

/** 便捷读当前源 handle（连接线/反馈计算用） */
export function getSourceHandle(state: ConnectionFeedbackState): 'source' | 'target' | null {
  return state.activeConnection.value?.sourceHandle ?? null
}

// 供内部 rAF 节流写 hoverNode 使用的最小读写句柄（ConnectionLineHost 用）
export interface HoverWriter {
  read(): HoverFeedback | null
  write(h: HoverFeedback | null): void
}

export function hoverWriter(state: ConnectionFeedbackState): HoverWriter {
  return {
    read: () => state.hoverNode.value,
    write: (h) => {
      state.hoverNode.value = h
    },
  }
}
