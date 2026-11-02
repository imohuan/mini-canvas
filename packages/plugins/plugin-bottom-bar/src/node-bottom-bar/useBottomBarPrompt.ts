import { computed, ref, watch, type ComputedRef } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import { initialPromptDoc, initialPromptText } from '../promptPersist'

interface PromptDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  promptBinding: ComputedRef<'none' | 'text'>
  persistValuesSoon: () => void
}

/** 提示词正文的同步与写回（正文 / 富文本快照的创建留在入口，保持原初始化顺序）。 */
export function useBottomBarPrompt(deps: PromptDeps) {
  const prompt = ref(initialPromptText(deps.props.data))
  const promptDoc = ref<unknown>(initialPromptDoc(deps.props.data))

  watch(
    () => deps.props.data?.text,
    (next) => {
      const text = typeof next === 'string' ? next : ''
      if (deps.promptBinding.value === 'text' && text !== prompt.value) prompt.value = text
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
