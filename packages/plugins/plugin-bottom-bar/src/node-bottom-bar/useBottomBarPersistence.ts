import type { ComputedRef, Ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import { promptDocPersistFields, promptPersistFields } from '../promptPersist'

interface PersistDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  currentId: Ref<string>
  values: Ref<Record<string, unknown>>
  storedActionId: ComputedRef<string | undefined>
  showEditor: ComputedRef<boolean>
  promptBinding: ComputedRef<'none' | 'text'>
  /** 对话模式：输入框内容存 barPrompt（与节点正文 data.text 解耦） */
  conversation?: ComputedRef<boolean>
  prompt: Ref<string>
  promptDoc: Ref<unknown>
}

/** 把当前参数与提示词落一份到节点 data（含 400ms 防抖与卸载 flush）。 */
export function useBottomBarPersistence(deps: PersistDeps) {
  function persistValues(): void {
    const rawStored = deps.ctx.tryGet<{
      getNode(id: string): { data?: Record<string, unknown> } | undefined
    }>('doc')?.getNode(deps.props.id)?.data?.barValues as Record<string, unknown> | undefined
    const storedAction = deps.storedActionId.value
    const onlyActionId =
      !rawStored || (Object.keys(rawStored).length > 0 && Object.keys(rawStored).every((k) => k === 'actionId'))
    if (storedAction === deps.currentId.value && onlyActionId) return
    if (!deps.showEditor.value && Object.keys(deps.values.value).length === 0) return
    try {
      deps.ctx.get('doc').updateNode(deps.props.id, {
        data: {
          barValues: { ...deps.values.value, actionId: deps.currentId.value },
          ...(deps.showEditor.value
            ? deps.conversation?.value
              ? promptPersistFields('none', deps.prompt.value)
              : promptPersistFields(deps.promptBinding.value, deps.prompt.value)
            : {}),
          ...(deps.showEditor.value && deps.promptDoc.value ? promptDocPersistFields(deps.promptDoc.value) : {}),
        },
      })
    } catch {
      /* 节点已不在等情况：忽略 */
    }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function persistValuesSoon(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistValues()
    }, 400)
  }

  function flushPersistValues(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    persistValues()
  }

  return { persistValues, persistValuesSoon, flushPersistValues }
}
