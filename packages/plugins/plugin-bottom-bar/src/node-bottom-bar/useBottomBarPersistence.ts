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
    // 对话模式（文本节点 agent:chat）没有底栏动作，showEditor 恒为 false，
    // 但输入框内容同样要落盘（barPrompt）—— 用户 2026-11-10：发送后输入框不能丢。
    const storedValues = deps.props.data?.barValues as { actionId?: unknown } | undefined
    /** 同一个判定要认两处：节点类型（对话模式）或节点数据里的动作 id（挂载首拍还没有类型） */
    const conversation =
      deps.conversation?.value === true || storedValues?.actionId === 'agent:chat'
    /**
     * 「参数没变」的快返只对**非对话**模式成立。
     *
     * 对话模式的 barValues 永远只有 actionId 一项，于是 storedAction === currentId
     * 且 onlyActionId 恒为真 —— 原来这行直接 return，barPrompt 一次都没写进节点
     * （用户实测：画布里 barPrompt 一直停在上一次的值，输入框重挂载就被旧值顶掉）。
     */
    if (!conversation && storedAction === deps.currentId.value && onlyActionId) return
    if (!conversation && !deps.showEditor.value && Object.keys(deps.values.value).length === 0) return
    try {
      deps.ctx.get('doc').updateNode(deps.props.id, {
        data: {
          barValues: { ...deps.values.value, actionId: deps.currentId.value },
          ...(conversation
            ? promptPersistFields('none', deps.prompt.value)
            : deps.showEditor.value
              ? promptPersistFields(deps.promptBinding.value, deps.prompt.value)
              : {}),
          ...(conversation && deps.promptDoc.value
            ? promptDocPersistFields(deps.promptDoc.value)
            : deps.showEditor.value && deps.promptDoc.value
              ? promptDocPersistFields(deps.promptDoc.value)
              : {}),
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
