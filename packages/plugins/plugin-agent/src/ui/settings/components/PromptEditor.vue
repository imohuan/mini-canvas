<script setup lang="ts">
/**
 * PromptEditor —— 三种提示词共用的正文编辑器（多行框 + 变量面板）。
 *
 * 变量插入与滚动位置在本组件里做一次；Agent 提示词、模式提示词、系统提示词模板
 * 都复用它，避免三份实现各自漂移。
 */
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import PromptVariables from './PromptVariables.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 无障碍名称：多行框自己用 aria-label，不留成普通属性（aria-* 不会自动映射成 prop） */
    label: string
    placeholder?: string
    readonly?: boolean
    scope?: 'content' | 'template'
    height?: number
  }>(),
  { readonly: false, scope: 'content', height: 220 },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const Textarea = useUiComponent('Textarea')
const textarea = ref<{ $el?: unknown } | null>(null)

function textareaElement(): HTMLTextAreaElement | null {
  const el = textarea.value?.$el
  return el instanceof HTMLTextAreaElement ? el : null
}

function insertToken(token: string): void {
  if (props.readonly) return
  const el = textareaElement()
  if (!el) {
    emit('update:modelValue', props.modelValue + token)
    return
  }
  const start = el.selectionStart ?? props.modelValue.length
  const end = el.selectionEnd ?? start
  emit('update:modelValue', props.modelValue.slice(0, start) + token + props.modelValue.slice(end))
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}
</script>

<template>
  <div class="ped">
    <Textarea
      ref="textarea"
      :model-value="modelValue"
      :readonly="readonly"
      :aria-label="label"
      :placeholder="placeholder"
      class="ped-textarea"
      :style="{ height: height + 'px' }"
      @update:model-value="(value: string | number) => emit('update:modelValue', String(value))"
    />
    <PromptVariables :scope="scope" :readonly="readonly" @insert="insertToken" />
  </div>
</template>

<style scoped>
.ped { display: flex; flex-direction: column; gap: 8px; }
/* 高度由调用方的 height 决定；auto 只做保底。正文框自身可滚，外层不再套滚动条。 */
.ped-textarea { min-height: 140px; overflow-y: auto; field-sizing: fixed; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; }
</style>
