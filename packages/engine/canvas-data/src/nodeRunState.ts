/**
 * nodeRunState —— 节点"运行期状态"的**最小形状契约**（纯逻辑，零 Vue / 零 DOM）。
 *
 * 为什么单独一层：任务进度写在哪、由谁写（plugin-bottom-bar 经 doc.updateNodeRuntime，
 * 或 cloud-server 经 batchNodes 写回同一把 key），是**插件/后台**的事；但"这个节点现在是不是
 * 正在跑任务"这条判定，渲染层（卡片尺寸 / VueFlow 包裹尺寸）也要读 —— 而渲染层不认识那些插件。
 * 所以把"写"留在各自插件，把"读形状"收敛到这里一处，谁都不必去猜对方发明的私有字段。
 *
 * 数据位置：`node.data.runState`（与 plugin-bottom-bar 的 readRunState 同一把 key）。
 * 这里只认 `status` 字段与 `'running'` 这一个取值 —— 需要更完整的归一（progress/message…）
 * 的显示侧仍用自己的 readRunState，本文件不抢它的活。
 */

/** 运行中状态字面量（与 plugin-bottom-bar / cloud-server 写入的取值同词表） */
export const NODE_RUNNING_STATUS = 'running'

/** 可判定"是否在跑任务"的最小形状：任何带 data 的节点 */
export interface RunStateLike {
  data?: unknown
}

/**
 * 该节点当前是否"正在跑任务"（runState.status === 'running'）。
 *
 * 缺 data / 缺 runState / 非法值一律 false（不抛）—— 渲染层每帧都可能问它，必须廉价且安全。
 * 只读形状，不改写，也不据此落盘。
 */
export function isNodeRunning(node: RunStateLike | undefined | null): boolean {
  const data = node?.data as Record<string, unknown> | undefined | null
  if (!data) return false
  const runState = data.runState as { status?: unknown } | undefined | null
  return runState?.status === NODE_RUNNING_STATUS
}
