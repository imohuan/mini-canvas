import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { BarAction } from '../barTypes'
import { FALLBACK_TYPE_ICONS } from './icons'
import type { ModelIcon } from './modelIcons'
/** 图标判定收在 actionIcon：provider 的 icon → 图标名 → 标题猜测 → 兜底 */
import { resolveActionIcon, type ModelIconServiceLike } from './actionIcon'

interface ActionDeps {
  ctx: CanvasRenderContext['ctx']
  host: CanvasRenderContext['host']
  doc: ComputedRef<{
    getNode(id: string): { type?: string } | undefined
    subscribe(fn: () => void): () => void
  } | undefined>
}

/** 动作列表、当前动作、参数与参数落盘。 */
export function useBottomBarActions(
  props: { id: string; data: Record<string, unknown> },
  deps: ActionDeps,
) {
  const { ctx, host } = deps

  // —— 节点类型（props 没有 type，从 doc 取；订阅 doc 跟随） ——
  const nodeType = ref<string | undefined>(undefined)
  let docOff: (() => void) | null = null
  function syncNodeType(): void {
    nodeType.value = deps.doc.value?.getNode(props.id)?.type
  }
  syncNodeType()
  if (deps.doc.value) docOff = deps.doc.value.subscribe(() => syncNodeType())
  onBeforeUnmount(() => docOff?.())

  // —— 动作列表（热装卸后重读） ——
  const bar = computed(() => ctx.get<{ list(f?: { type?: string }): BarAction[] }>('nodeBar'))
  const actions = ref<BarAction[]>([])
  let barFieldOff: { dispose(): void } | null = null
  const pluginOffs: Array<{ dispose(): void }> = []
  function reloadActions(): void {
    actions.value = bar.value?.list({ type: nodeType.value }) ?? []
  }
  function watchBarField(): void {
    barFieldOff?.dispose()
    barFieldOff = null
    const field = ctx.registryOf('node/bar')
    if (field && typeof field.subscribe === 'function') {
      barFieldOff = field.subscribe(() => reloadActions())
    }
  }
  watch(nodeType, reloadActions, { immediate: true })
  watchBarField()
  pluginOffs.push(ctx.on('ctx:plugin-installed', () => { reloadActions(); watchBarField() }))
  pluginOffs.push(ctx.on('ctx:plugin-uninstalled', () => { reloadActions(); watchBarField() }))
  onBeforeUnmount(() => {
    barFieldOff?.dispose()
    for (const d of pluginOffs) d.dispose()
  })

  const hasActions = computed(() => actions.value.length > 0)

  /** 平台图标服务（装 Agent 时才有） */
  const iconService = computed(() => ctx.tryGet<ModelIconServiceLike>('modelIcons'))

  /**
   * 取一个动作的图标：
   * 1. 动作自带的 icon（provider 上传的 SVG / 图片）—— 最精确；
   * 2. Agent 提供的平台品牌图标 —— 用户口径「两处共用一套」；
   * 3. 本地兜底（认不出平台时按节点类型给个通用图形，绝不空白）。
   */
  function modelIconOfAction(a: BarAction): ModelIcon {
    return resolveActionIcon(a.title, a.icon, iconService.value, a.types?.[0] ?? nodeType.value)
  }

  const actionOptions = computed(() =>
    actions.value.map((a) => ({
      label: a.title,
      value: a.id,
      description: a.description,
      icon: iconOfType(a.types?.[0] ?? nodeType.value),
      /** 模型图标：provider 自带 → Agent 平台图标 → 本地兜底 */
      model: modelIconOfAction(a),
      group: a.group,
    })),
  )

  /** 当前选中动作的模型图标（触发器左侧那颗） */
  const currentModelIcon = computed<ModelIcon | null>(() => {
    const hit = actionOptions.value.find((o) => o.value === currentId.value)
    return hit ? hit.model : null
  })

  function iconOfType(type: string | undefined): unknown {
    if (!type) return undefined
    const reg = host.nodeRegistry as { get(t: string): { icon?: unknown } | undefined } | undefined
    const fromRegistry = reg?.get(type)?.icon
    if (fromRegistry) return fromRegistry
    return FALLBACK_TYPE_ICONS[type]
  }

  // —— 当前动作与参数 ——
  const currentId = ref('')
  const currentAction = computed<BarAction | undefined>(() => actions.value.find((a) => a.id === currentId.value))
  const currentActionLabel = computed(
    () => actionOptions.value.find((o) => o.value === currentId.value)?.label ?? '',
  )

  function plainObject(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : undefined
  }
  const values = ref<Record<string, unknown>>(plainObject(props.data?.barValues) ?? {})
  const storedActionId = computed<string | undefined>(() => {
    const raw = plainObject(props.data?.barValues)
    return typeof raw?.actionId === 'string' ? raw.actionId : undefined
  })

  function defaultActionId(): string {
    const list = actions.value
    return (list.find((a) => a.needsPrompt === true) ?? list[0])?.id ?? ''
  }

  function initialActionId(): string {
    const remembered = storedActionId.value
    if (remembered && actions.value.some((a) => a.id === remembered)) return remembered
    return defaultActionId()
  }

  /** select 无 default 取第一项（与内核 resolveToolParams 同口径） */
  function defaultsOf(action: BarAction | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const p of action?.fields ?? []) {
      if (p.default !== undefined) {
        out[p.key] = p.default
        continue
      }
      if (p.type === 'select' && p.options?.length) out[p.key] = p.options[0].value
    }
    return out
  }

  watch(
    () => actions.value.map((a) => a.id).join('|'),
    () => {
      if (!actions.value.some((a) => a.id === currentId.value)) {
        const remembered = storedActionId.value
        const pick = remembered && actions.value.some((a) => a.id === remembered) ? remembered : defaultActionId()
        selectAction(pick)
      }
    },
  )

  /**
   * 这个值在新动作的选项里还合法吗。
   *
   * 只对「有固定候选值」的参数有意义（select / grid / number+options）；
   * 数值、文本、开关没有候选集，一律算合法。
   *
   * 空串也算**不合法**：它等于「没选」，会盖掉新动作的 default。
   */
  function valueFitsField(p: ToolParamDef, v: unknown): boolean {
    const hasOptions = (p.options?.length ?? 0) > 0
    if (!hasOptions) return true
    if (v === undefined || v === null || v === '') return false
    return (p.options ?? []).some((o) => String(o.value) === String(v))
  }

  function selectAction(id: string): void {
    const prev = currentAction.value
    if (prev?.onDeselect) prev.onDeselect(props.id)
    currentId.value = id
    /*
     * 换动作时保留用户已经调过的参数，但必须同时满足两个条件：
     *
     * 1. key 在新动作里也声明了；
     * 2. 那个值在新动作的候选值里**还合法**。
     *
     * 第 2 条是必须的（用户 2026-11-09 截图：切到「Base64 图标」后，
     * 唯一的下拉显示成空白）：两个动作都用了 `model` 这个 key，但候选值不同 ——
     * 旧动作是 `v2`，新动作只有 `a/b/c`。只按 key 判断就会把 `v2` 留下来，
     * 它既不是新动作的任何一项、又盖住了 default `a`，于是下拉匹配不上任何选项，
     * 显示成占位符。
     */
    const kept: Record<string, unknown> = {}
    for (const p of (currentAction.value?.fields ?? []) as ToolParamDef[]) {
      if (!(p.key in values.value)) continue
      const v = values.value[p.key]
      if (valueFitsField(p, v)) kept[p.key] = v
    }
    values.value = { ...defaultsOf(currentAction.value), ...kept }
    currentAction.value?.onSelect?.(props.id)
  }

  if (hasActions.value && !currentId.value) selectAction(initialActionId())

  const promptBinding = computed(() => currentAction.value?.promptBinding ?? 'none')
  const needsPrompt = computed(() => currentAction.value?.needsPrompt === true)
  const paramDefs = computed<ToolParamDef[]>(() =>
    ((currentAction.value?.fields ?? []) as ToolParamDef[]).filter((p) => p.kind !== 'style'),
  )
  const showEditor = computed(() => needsPrompt.value)

  function onFieldChange(key: string, v: string | number | boolean): void {
    values.value = { ...values.value, [key]: v }
  }

  const fieldSummary = computed(() => {
    const parts: string[] = []
    for (const p of paramDefs.value) {
      const v = values.value[p.key]
      if (v === undefined || v === '') continue
      const opt = p.options?.find((o) => o.value === v)
      parts.push(opt ? opt.label : String(v))
    }
    return parts.join(' · ')
  })

  return {
    nodeType,
    actions,
    hasActions,
    actionOptions,
    currentId,
    currentAction,
    currentActionLabel,
    currentModelIcon,
    values,
    storedActionId,
    selectAction,
    onFieldChange,
    fieldSummary,
    promptBinding,
    needsPrompt,
    paramDefs,
    showEditor,
  }
}
