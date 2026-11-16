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

/**
 * 把新一帧运行状态并到旧一帧上（**同一个任务**的进度帧才合并）。
 *
 * 为什么需要它：进度帧是**整块替换** `runState` 的。任何一条写进度的路径只要漏带一个字段
 * （最近的真实问题：漏了 `startedAt`，加载卡右上角的耗时每两秒被抹掉一次），就会丢掉旧值。
 * 在数据层统一合并，写入方不必各自记得补字段。
 *
 * 合并范围刻意收窄，避免「老任务的东西串到新任务」：
 * - 两边都是 running、且**任务号一致**（都没有也算一致）→ 浅合并，新帧优先；
 * - 任一边没有任务号而另一边有（典型：刚点提交的新帧 vs 上一个还在跑的任务）→ 整帧替换，
 *   这样新任务绝不会继承旧任务的编号 —— 否则兜底对账会拿着旧号去查、把新任务覆盖成旧状态；
 * - 任务号不同 → 整帧替换，旧任务的进度 / 耗时 / 文案一概不继承；
 * - 任一边不是 running（done / error / idle）→ 整帧替换，终态保持干净。
 *
 * 只做**浅**合并：`stats` 这类嵌套对象整体以新帧为准，避免新旧字段拼出一个不存在的进度。
 */
export function mergeNodeRunState(prev: unknown, next: unknown): unknown {
  if (!isPlainObject(next)) return next
  if (!isPlainObject(prev)) return next
  if (prev.status !== NODE_RUNNING_STATUS || next.status !== NODE_RUNNING_STATUS) return next
  const taskOf = (state: Record<string, unknown>): string =>
    typeof state.taskId === 'string' ? state.taskId : ''
  if (taskOf(prev) !== taskOf(next)) return next
  return { ...prev, ...next }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
