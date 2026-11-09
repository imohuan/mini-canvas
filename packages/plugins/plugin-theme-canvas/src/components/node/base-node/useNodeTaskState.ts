import { computed } from 'vue'
import { readNodeVisualState } from '@mini-canvas/canvas-data'

/**
 * 节点的任务态（全局三态：loading / error / ready）与它的派生量。
 *
 * 用户口径 2026-11-09：节点只有错误 / 加载中 / 加载成功三种状态，且要**全局** ——
 * 加载覆盖层由节点壳自己画，不再依赖底部状态栏插件挂条目。
 * 所以这里只读 `data.runState`（与任务写入方同一把 key），不认识任何业务插件。
 */
export interface NodeTaskStateInput {
  data: () => Record<string, unknown> | undefined
}

export function useNodeTaskState(input: NodeTaskStateInput) {
  /** 三态：loading = 正在跑，error = 失败/暂停后整卡覆盖，ready = 正常 */
  const visualState = computed(() => readNodeVisualState({ data: input.data() }))
  const loading = computed(() => visualState.value === 'loading')
  const failed = computed(() => visualState.value === 'error')
  /** 卡上被覆盖层盖住（加载中或失败） */
  const covered = computed(() => visualState.value !== 'ready')

  const runState = computed(
    () => (input.data()?.runState ?? {}) as {
      status?: unknown
      progress?: unknown
      message?: unknown
      startedAt?: unknown
    },
  )
  /** 0-100；非法/缺失 → null（不确定态，不编一个假数字） */
  const percent = computed(() => {
    const p = runState.value.progress
    return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null
  })
  /** 阶段文案（失败时就是失败原因） */
  const message = computed(() =>
    typeof runState.value.message === 'string' ? runState.value.message : '',
  )
  /** 计时起点（ms）；没写就不显示耗时 */
  const startedAt = computed(() => {
    const v = runState.value.startedAt
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  })

  return { visualState, loading, failed, covered, percent, message, startedAt }
}
