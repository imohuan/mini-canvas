import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { BarAction } from '../barTypes'
import {
  loadAiActions,
  requestAiText,
  resolveAgentBaseUrl,
  normalizeAiActions,
  AI_ACTIONS_CHANGED_EVENT,
  type AiActionsChangedPayload,
  DEFAULT_AI_ICON,
  type AiActionConfig,
} from '../aiActions'
import { promptPersistFields } from '../promptPersist'
import type { BottomBarEditorHandle } from './types'

interface AiDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  nodeType: Ref<string | undefined>
  currentAction: ComputedRef<BarAction | undefined>
  promptBinding: ComputedRef<'none' | 'text'>
  prompt: Ref<string>
  promptDoc: Ref<unknown>
  showEditor: ComputedRef<boolean>
  editorComponentRef: Ref<BottomBarEditorHandle | null>
}

/** AI 按钮清单、流式写入与批量落盘。 */
export function useBottomBarAiActions(deps: AiDeps) {
  const aiActions = ref<AiActionConfig[]>([])
  const aiRunningId = ref<string | null>(null)
  const aiPhase = ref<'idle' | 'starting' | 'streaming'>('idle')
  const aiEditorLocked = ref(false)
  const aiError = ref('')
  let aiAbort: AbortController | null = null
  let aiFlushTimer: ReturnType<typeof setTimeout> | null = null
  let aiFlushPending = false
  let aiLoadSeq = 0

  async function reloadAiActions(): Promise<void> {
    const seq = ++aiLoadSeq
    const base = resolveAgentBaseUrl(deps.ctx)
    try {
      const list = await loadAiActions({ baseUrl: base })
      if (seq === aiLoadSeq) aiActions.value = list
    } catch {
      if (seq === aiLoadSeq) aiActions.value = []
    }
  }
  reloadAiActions()
  const offAiActions = deps.ctx.on('ctx:plugin-installed', () => void reloadAiActions())

  const offAiActionsChanged = deps.ctx.on(AI_ACTIONS_CHANGED_EVENT, (payload?: AiActionsChangedPayload) => {
    if (Array.isArray(payload?.actions)) {
      aiLoadSeq += 1
      aiActions.value = normalizeAiActions(payload.actions)
      return
    }
    void reloadAiActions()
  })

  const aiButtons = computed(() => aiActions.value.filter((a) => a.enabled).map((a) => ({ ...a, icon: a.icon || DEFAULT_AI_ICON })))

  function onAiDelta(fullText: string): void {
    deps.prompt.value = fullText
    deps.promptDoc.value = undefined
    scheduleAiFlush()
  }

  function scheduleAiFlush(): void {
    aiFlushPending = true
    if (aiFlushTimer) return
    aiFlushTimer = setTimeout(() => {
      aiFlushTimer = null
      if (!aiFlushPending) return
      aiFlushPending = false
      flushAiPrompt()
    }, 500)
  }

  function flushAiPrompt(): void {
    try {
      const doc = deps.ctx.get<{ updateNode(id: string, patch: { data: Record<string, unknown> }): void }>('doc')
      if (deps.promptBinding.value === 'text') {
        doc.updateNode(deps.props.id, { data: { text: deps.prompt.value } })
      } else {
        doc.updateNode(deps.props.id, { data: promptPersistFields(deps.promptBinding.value, deps.prompt.value) })
      }
    } catch {
      /* 节点已不在等情况：忽略（下一拍还会再写） */
    }
  }

  async function runAiAction(action: AiActionConfig): Promise<void> {
    if (aiRunningId.value) return
    const source = deps.prompt.value
    if (!source.trim()) return
    const base = resolveAgentBaseUrl(deps.ctx)
    const retriesRaw = deps.ctx.tryGet<{ get(key: string): string | number | boolean }>('settings')?.get('bottomBarAiRetries')
    const retryRounds = typeof retriesRaw === 'number' && retriesRaw >= 1 ? Math.floor(retriesRaw) : undefined
    aiRunningId.value = action.id
    aiError.value = ''
    aiAbort = new AbortController()
    aiPhase.value = 'starting'
    aiEditorLocked.value = true
    deps.editorComponentRef.value?.setEditable?.(false)
    let cleared = false
    let full = ''
    try {
      const res = await requestAiText({
        template: action.template,
        vars: {
          prompt: source,
          nodeType: deps.nodeType.value ?? '',
          action: deps.currentAction.value?.title ?? '',
          nodeId: deps.props.id,
        },
        baseUrl: base,
        ...(retryRounds === undefined ? {} : { retryRounds }),
        signal: aiAbort.signal,
        onDelta: (delta) => {
          if (!cleared) {
            cleared = true
            aiPhase.value = 'streaming'
            deps.prompt.value = ''
            deps.promptDoc.value = undefined
            full = ''
          }
          full += delta
          onAiDelta(full)
        },
      })
      if (res.ok) {
        if (!cleared) {
          cleared = true
          aiPhase.value = 'streaming'
          deps.prompt.value = ''
          deps.promptDoc.value = undefined
          full = ''
        }
        onAiDelta(full)
        flushAiPrompt()
      } else {
        if (!cleared) {
          deps.prompt.value = source
          deps.promptDoc.value = undefined
        }
        flushAiPrompt()
        aiError.value = res.error
        setTimeout(() => { if (aiError.value === res.error) aiError.value = '' }, 4000)
      }
    } finally {
      aiRunningId.value = null
      aiAbort = null
      aiPhase.value = 'idle'
      aiEditorLocked.value = false
      deps.editorComponentRef.value?.setEditable?.(true)
      if (aiFlushTimer) { clearTimeout(aiFlushTimer); aiFlushTimer = null }
      aiFlushPending = false
    }
  }

  function cancelAi(): void {
    aiAbort?.abort()
  }

  onBeforeUnmount(() => {
    if (aiFlushTimer) { clearTimeout(aiFlushTimer); aiFlushTimer = null }
    if (aiFlushPending) { aiFlushPending = false; flushAiPrompt() }
    aiAbort?.abort()
    offAiActions.dispose()
    offAiActionsChanged.dispose()
  })

  return {
    aiActions,
    aiRunningId,
    aiPhase,
    aiEditorLocked,
    aiError,
    aiButtons,
    runAiAction,
    cancelAi,
  }
}
