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
  AimedTarget,
} from '../contracts/connectionContext'

/** 建一份可注入的默认连接反馈状态 */
export function createConnectionState(): ConnectionFeedbackState {
  const activeConnection = ref<ActiveConnection | null>(null)
  const hoverNode = ref<HoverFeedback | null>(null)
  const aimedTarget = ref<AimedTarget | null>(null)
  const suppressHandles = ref(false)
  const isConnecting = computed(() => activeConnection.value !== null)
  return {
    isConnecting,
    activeConnection,
    hoverNode,
    aimedTarget,
    suppressHandles,
  }
}

/** 开始拖线：记录源 + 压端口 + 清反馈 */
export function beginConnection(
  state: ConnectionFeedbackState,
  active: ActiveConnection,
): void {
  state.activeConnection.value = active
  state.suppressHandles.value = true
  state.hoverNode.value = null
  state.aimedTarget.value = null
}

/** 结束拖线（connect-end / connect 兜底）：清空悬停/压端口。 */
export function endConnection(state: ConnectionFeedbackState): void {
  state.activeConnection.value = null
  state.suppressHandles.value = false
  state.hoverNode.value = null
  state.aimedTarget.value = null
}

/** 便捷读当前源 handle（连接线/反馈计算用） */
export function getSourceHandle(state: ConnectionFeedbackState): 'source' | 'target' | null {
  return state.activeConnection.value?.sourceHandle ?? null
}

/**
 * 某节点是不是"本次拖线的源"（谁在拖线时，用它判断自己该不该被压端口 / 该不该亮 3D）。
 *
 * 兼容单源与多源：给了 sourceNodeIds（批量连线：选中集里每个节点都是源）就按集合判；
 * 只给 sourceNodeId（从节点端口拖线）就按那一个 id 判 —— 旧行为逐字不变。
 *
 * 之所以抽成函数：这段"我是不是源"的判断散在 UI 层（BaseNode 的 isCurrentConnectingNode、
 * 端口压制、3D 反馈）好几处，各写一遍必然漏掉多源那一路 —— 抽出来就只有一个地方要维护。
 */
export function isConnectionSource(
  active: ActiveConnection | null | undefined,
  nodeId: string,
): boolean {
  if (!active) return false
  if (active.sourceNodeIds && active.sourceNodeIds.length > 0) {
    return active.sourceNodeIds.includes(nodeId)
  }
  return active.sourceNodeId === nodeId
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
