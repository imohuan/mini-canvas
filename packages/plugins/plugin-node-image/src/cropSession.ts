/**
 * cropSession —— "这个节点正在裁剪"的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 为什么需要它：裁剪覆盖层画在 content 段（ImageContent），而入口按钮在 top-toolbar 段——
 * 两者是 BaseNode 渲染出来的**兄弟组件**，只共享 nodeId。内核 data 是唯一跨组件通道，
 * 但把"正在裁剪"写进 data 有两个坏处：
 *   1. 会落盘。内核保存只过滤 data.transient/isTemp，_overlay 这类临时字段会被存下来，刷新后
 *      画布一开就停在裁剪模式（v1 靠宿主手动 strip，v2 没有这层）；
 *   2. 会进历史。进/退裁剪变成一个可撤销操作，撤销栈里会混进纯 UI 状态。
 *
 * 所以这里用一个"按 nodeId 记名字"的模块级响应式集合：同包组件直接共享，出画布即消失。
 * 纯状态逻辑，无 DOM，node 可单测。
 */
import { reactive } from 'vue'

/** 正在裁剪的节点 id 集合（响应式；同包组件共享同一实例） */
const cropping = reactive(new Set<string>())

/** 当前裁剪中的节点 id（供测试与诊断；只读快照） */
export function croppingIds(): string[] {
  return [...cropping]
}

/** 该节点是否正在裁剪 */
export function isCropping(nodeId: string): boolean {
  return cropping.has(nodeId)
}

/** 进入裁剪模式（幂等） */
export function beginCrop(nodeId: string): void {
  if (!nodeId) return
  cropping.add(nodeId)
}

/** 退出裁剪模式（确认/取消/节点卸载都调它；幂等） */
export function endCrop(nodeId: string): void {
  cropping.delete(nodeId)
}
