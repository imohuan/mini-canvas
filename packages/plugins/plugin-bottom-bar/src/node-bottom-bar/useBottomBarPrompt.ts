import { computed, ref, watch, type ComputedRef } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import { initialPromptDoc, initialPromptText } from '../promptPersist'

interface PromptDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  promptBinding: ComputedRef<'none' | 'text'>
  persistValuesSoon: () => void
  /**
   * 对话模式（文本节点走 agent:chat）。
   *
   * 为 true 时输入框**与节点正文彻底解耦**（用户 2026-11-10）：
   * · 内容存 `data.barPrompt`，存的是「你的问题」；
   * · 不跟随 `data.text`（那是模型答案，会不断流式变化）；
   * · 发送后不会被答案覆盖，任务完成后仍留着你写的问题。
   */
  conversation?: ComputedRef<boolean>
}

/** 提示词正文的同步与写回（正文 / 富文本快照的创建留在入口，保持原初始化顺序）。 */
export function useBottomBarPrompt(deps: PromptDeps) {
  const conversationMode = () => deps.conversation?.value === true
  const prompt = ref(initialPromptText(deps.props.data, { preferBarPrompt: conversationMode() }))
  const promptDoc = ref<unknown>(initialPromptDoc(deps.props.data))

  watch(
    () => deps.props.data?.text,
    (next) => {
      const text = typeof next === 'string' ? next : ''
      // 对话模式不跟随 data.text —— 那是模型答案，会流式变化（用户 2026-11-10）
      if (conversationMode()) return
      if (deps.promptBinding.value === 'text' && text !== prompt.value) prompt.value = text
    },
  )
  // 对话模式跟随 barPrompt（切画布 / 重挂载后恢复你上次写的问题）
  watch(
    () => deps.props.data?.barPrompt,
    (next) => {
      if (!conversationMode()) return
      const text = typeof next === 'string' ? next : ''
      if (text !== prompt.value) prompt.value = text
    },
  )
  watch(
    () => deps.props.data?.barPrompt,
    (next) => {
      const text = typeof next === 'string' ? next : ''
      if (deps.promptBinding.value === 'none' && text !== prompt.value) prompt.value = text
    },
  )

  function onPromptUpdate(v: string): void {
    prompt.value = v
    // 对话模式：输入框内容 = 「你的问题」，落 barPrompt（绝不写 data.text ——
    // 那是节点正文/模型答案，用户 2026-11-10）。
    if (conversationMode()) {
      deps.persistValuesSoon()
      return
    }
    if (deps.promptBinding.value === 'text') {
      deps.ctx.get('doc').updateNode(deps.props.id, { data: { text: v } })
    } else {
      deps.persistValuesSoon()
    }
  }

  const CHAR_LIMIT = 2000
  const charCount = computed(() => prompt.value.length)
  return { prompt, promptDoc, onPromptUpdate, CHAR_LIMIT, charCount }
}
