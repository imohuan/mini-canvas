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
      label?: unknown
      reason?: unknown
      hint?: unknown
      stats?: unknown
      value?: unknown
      suffix?: unknown
      progressText?: unknown
      tail?: unknown
    },
  )
  /** 0-100；非法/缺失 → null（不确定态，不编一个假数字） */

  /**
   * 是否正在「流式长出内容」：加载中，且已经有正文可看。
   *
   * 用户口径 2026-11-10：AI 对话是按批吐字的，前端要能看到中间结果；
   * 只显示 5% 然后一下跳到完成，等于没做流式。
   * 所以「加载中且有内容」时，壳把正文露出来、只留状态条，而不是全屏盖住。
   */
  const streaming = computed(() => {
    if (!loading.value) return false
    const d = input.data()
    const t = d?.text
    return typeof t === 'string' && t.trim() !== ''
  })

  /**
   * 已产出量（`runState.stats`，由执行方写：文本对话是「已输出 N 字 / ≈M tokens」）。
   * 只用于加载层显示；别的任务类型不写，就没有。
   */
  const stats = computed(() => {
    const s = runState.value.stats
    if (!s || typeof s !== 'object') return undefined
    const raw = s as { chars?: unknown; tokens?: unknown }
    const chars = typeof raw.chars === 'number' && Number.isFinite(raw.chars) ? Math.max(0, Math.floor(raw.chars)) : undefined
    const tokens = typeof raw.tokens === 'number' && Number.isFinite(raw.tokens) ? Math.max(0, Math.floor(raw.tokens)) : undefined
    return chars === undefined && tokens === undefined ? undefined : { chars, tokens }
  })
  const percent = computed(() => {
    const p = runState.value.progress
    return typeof p === 'number' && Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null
  })
  /** 阶段文案（失败时就是失败原因） */
  const message = computed(() =>
    typeof runState.value.message === 'string' ? runState.value.message : '',
  )
  /**
   * 状态词（左上角那一句）。由**执行方**写进 `runState.label`，壳不再写死话术。
   * 没写时返回空串，由调用方决定兜底（默认加载件会回落到「生成中 / 执行失败」）。
   */
  const label = computed(() =>
    typeof runState.value.label === 'string' ? runState.value.label : '',
  )
  /**
   * 失败原因。契约字段是 `runState.reason`；老数据 / 后台写的仍是 `message`，这里一并认。
   * 两者都没有就空串 —— 不编一句假原因。
   */
  const reason = computed(() => {
    const r = runState.value.reason
    if (typeof r === 'string' && r !== '') return r
    return message.value
  })
  /** 失败态第二行小字（下一步能做什么）。契约字段 `runState.hint`，没写就不显示这一行 */
  const hint = computed(() =>
    typeof runState.value.hint === 'string' ? runState.value.hint : '',
  )
  /** 计时起点（ms）；没写就不显示耗时 */

  /**
   * 正在返回的那一小段（用户 2026-11-10：「实时流输出的滑动文本效果」）。
   * 取正文末尾，只用于加载层显示 —— 整篇在节点正文里。
   */
  const streamTail = computed(() => {
    if (!loading.value) return ''
    // 后台给了 tail 就用它（provider 决定显示哪一段）；没给才回落到正文末尾
    const t = runState.value.tail
    if (typeof t === 'string' && t !== '') return t
    const body = input.data()?.text
    return typeof body === 'string' ? body.slice(-40) : ''
  })

  /**
   * 加载 UI 的大数字 / 单位 / 整段文案 —— **全部由后台写**（`runState.value` 等）。
   *
   * 用户口径 2026-11-10：进度是后台的数据，provider 轮询结果决定显示什么；
   * 前端只读字段画出来，不判断任务类型、不估算 token。
   */
  const displayValue = computed(() => {
    const v = runState.value.value
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null
  })
  const displaySuffix = computed(() => {
    const s = runState.value.suffix
    return typeof s === 'string' && s !== '' ? s : '%'
  })
  const displayText = computed(() => {
    const s = runState.value.progressText
    return typeof s === 'string' ? s : ''
  })

  const startedAt = computed(() => {
    const v = runState.value.startedAt
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  })

  return {
    visualState, loading, failed, covered, percent, message, label, reason, hint, startedAt,
    stats, streaming, streamTail,
    displayValue, displaySuffix, displayText,
  }
}
