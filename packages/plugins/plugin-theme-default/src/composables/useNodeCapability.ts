/**
 * useNodeCapability —— 由节点类型"连接能力"推导端口显隐（替代 v1 的 canReceiveInput/canProduceOutput 布尔）。
 *
 * v2 内核能力模型是"声明了才约束"：nodeStore.types 里某 type 未声明 inputs/outputs 或声明非空 = 默认可连；
 * 只有当显式声明为空数组(或 inputs 只为某个 port)才算限制。见 kernel connection.ts（connection.ts:199-203）：
 *   hasSourcePort = !outputs || outputs.length > 0
 *   hasTargetPort = !inputs  || inputs.length > 0
 *
 * 与 v1 语义对齐：v1 canReceiveInput/canProduceOutput 默认 true；v2 未声明 inputs/outputs 即默认可进可出。
 *
 * 用法（BaseNode）：
 *   const cap = useNodeCapability(props.type)
 *   v-if="cap.hasTarget" 渲染 target 口、v-if="cap.hasSource" 渲染 source 口。
 */
import { computed } from 'vue'
import type { NodeStoreService } from '@mini-canvas/canvas-core-v2'
import { useCanvasRender } from '@mini-canvas/canvas-render'

export function useNodeCapability(type: string) {
  const { ctx } = useCanvasRender()
  const store = ctx.get<NodeStoreService>('nodeStore')
  const nodeDef = computed(() => store.types.get(type))

  /** 该 type 是否有输入(target)能力（有 inputs 声明且非空才限制输入，否则默认有） */
  const hasTarget = computed(() => {
    const inputs = nodeDef.value?.inputs
    return !inputs || inputs.length > 0
  })

  /** 该 type 是否有输出(source)能力 */
  const hasSource = computed(() => {
    const outputs = nodeDef.value?.outputs
    return !outputs || outputs.length > 0
  })

  /** 节点类型默认尺寸（resize 初值来源）；缺省 256×128 兜底 */
  const defaultSize = computed(() => {
    const s = nodeDef.value?.defaultSize
    return s ? { w: s.w, h: s.h } : { w: 256, h: 128 }
  })

  return { hasTarget, hasSource, defaultSize }
}
