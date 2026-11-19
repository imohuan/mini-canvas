/**
 * 底栏文案（参数下拉标题 + 发送按钮里的花费）—— 用户 2026-11-17。
 *
 * 三个输入一变就重新问后台：
 * 1. 当前动作（换模型 = 换价格表）；
 * 2. 参数值（改分辨率 / 质量就变钱）；
 * 3. 参考图张数（图生图按张收输入费）。
 *
 * 三条纪律：
 * - 动作没声明 hasSelectLabel / hasSendLabel → 一个请求都不发（老 provider 零负担）；
 * - 请求进行中又来新值 → 用序号丢弃旧结果（防止慢请求把新价格盖回去）；
 * - 失败 / 超时 → 回落默认摘要，不弹错、不挡住发送。
 */
import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { BarAction } from '../barTypes'
import { fetchActionLabels, labelCacheKey, type ActionLabelText } from '../actionLabels'
import { resolveAgentBaseUrl } from '../aiActions'
import type { ToolParamDef } from '@plume-canvas/kernel'
import { paramLabelMap } from './paramSummary'

/**
 * 素材张数怎么算（纯函数，可单测）。
 *
 * 只看 kind 属于四种媒体；其它（未知 kind / 空项）忽略。
 * 参考图张数会进 provider 的花费公式，所以这里必须稳定。
 */
export function countResourcesByKind(
  list: ReadonlyArray<{ kind?: string | null }> | undefined,
): { image: number; video: number; audio: number; text: number } {
  const out = { image: 0, video: 0, audio: 0, text: 0 }
  for (const item of list ?? []) {
    const kind = item?.kind
    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text') out[kind] += 1
  }
  return out
}

export interface ActionLabelDeps {
  ctx: {
    tryGet<T>(name: string): T | undefined
  }
  currentAction: ComputedRef<BarAction | undefined>
  paramDefs: ComputedRef<ToolParamDef[]>
  values: Ref<Record<string, unknown>>
  /** 已经拼好的默认摘要（没有自定义标题时显示它） */
  summary: ComputedRef<string>
  /** 上游素材张数（按 kind 分；参考图影响花费） */
  resourceCounts?: ComputedRef<{ image: number; video: number; audio: number; text: number }>
}

export function useActionLabels(deps: ActionLabelDeps) {
  const custom = ref<ActionLabelText>({})
  let seq = 0
  /** 上一次问过的键：同一份输入不重复问 */
  let lastKey = ''
  let disposed = false

  const wantsSelect = computed(() => (deps.currentAction.value as { hasSelectLabel?: boolean } | undefined)?.hasSelectLabel === true)
  const wantsSend = computed(() => (deps.currentAction.value as { hasSendLabel?: boolean } | undefined)?.hasSendLabel === true)

  /** 参数下拉上真正显示的标题：provider 说空就用默认摘要 */
  const selectLabel = computed(() => {
    const t = custom.value.selectLabel
    return typeof t === 'string' && t.trim() !== '' ? t : deps.summary.value
  })

  /** 发送按钮里的文字；空串 = 只画图标 */
  const sendLabel = computed(() => {
    const t = custom.value.sendLabel
    return typeof t === 'string' ? t.trim() : ''
  })

  async function refresh(): Promise<void> {
    const action = deps.currentAction.value
    const actionId = action?.id ?? ''
    if (!actionId || (!wantsSelect.value && !wantsSend.value)) {
      custom.value = {}
      lastKey = ''
      return
    }
    const fields = (deps.paramDefs.value ?? []) as ToolParamDef[]
    const input = {
      actionId,
      values: { ...(deps.values.value ?? {}) },
      labels: paramLabelMap({ fields, values: deps.values.value ?? {} }),
      summary: deps.summary.value,
      resources: deps.resourceCounts?.value ?? { image: 0, video: 0, audio: 0, text: 0 },
    }
    const key = labelCacheKey(input)
    if (key === lastKey) return
    lastKey = key

    const mine = ++seq
    const result = await fetchActionLabels([input], { baseUrl: resolveAgentBaseUrl(deps.ctx) })
    if (disposed || mine !== seq) return
    custom.value = result[actionId] ?? {}
  }

  watch([() => deps.currentAction.value?.id, () => deps.values.value, () => deps.paramDefs.value], () => {
    void refresh()
  }, { immediate: true, deep: true })

  // 参考图增减也影响花费：素材数量变化时补问一次
  if (deps.resourceCounts) {
    watch(deps.resourceCounts, () => {
      lastKey = ''
      void refresh()
    }, { deep: true })
  }

  onBeforeUnmount(() => {
    disposed = true
  })

  return { selectLabel, sendLabel, wantsSelect, wantsSend, refresh }
}
