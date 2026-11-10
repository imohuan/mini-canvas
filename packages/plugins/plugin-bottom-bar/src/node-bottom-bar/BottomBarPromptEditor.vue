<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ProseMirrorEditor, type ResourceItem } from 'prosemirror-editor-bundle'
import type { BottomBarEditorHandle } from './types'

const props = defineProps<{
  prompt: string
  promptDoc: unknown
  editorStyle: Record<string, string>
  aiPhase: 'idle' | 'starting' | 'streaming'
  aiEditorLocked: boolean
  editorResources: ResourceItem[]
  /** 与 ProseMirrorEditor 的 prop 声明一致：按 token 解析，找不到返回 null */
  resolveResource: (name: string) => ResourceItem | null
  onPasteFiles: (files: File[], editorCtx: { insert(item: ResourceItem): void }) => Promise<boolean>
}>()

const emit = defineEmits<{
  update: [value: string]
  updatePromptDoc: [value: unknown]
  ready: [editor: BottomBarEditorHandle | null]
}>()

const editorComponentRef = ref<BottomBarEditorHandle | null>(null)
const promptDocModel = computed({
  get: () => props.promptDoc,
  set: (v: unknown) => emit('updatePromptDoc', v),
})
watch(editorComponentRef, (editor) => emit('ready', editor), { immediate: true })
/** 编辑器是否为空（占位符判据，定义要早于下面的 watch） */
const editorEmpty = ref(true)

/**
 * 编辑器是否为空 —— 占位符的唯一判据之一。
 *
 * 只读外部 prompt 不够：外部 modelValue 与 ProseMirror 文档是异步同步的，
 * 中间那一拍会「prompt 已空、编辑器里还有字」，于是占位符和正文叠在一起（用户 2026-11-10）。
 * 这里直接问编辑器本体。
 */
function syncEditorEmpty(): void {
  const ed = editorComponentRef.value
  if (!ed || typeof ed.isEmpty !== 'function') {
    editorEmpty.value = props.prompt.length === 0
    return
  }
  editorEmpty.value = ed.isEmpty()
}
watch(editorComponentRef, syncEditorEmpty, { immediate: true })
watch(() => props.prompt, () => syncEditorEmpty())
watch(
  () => props.promptDoc,
  () => syncEditorEmpty(),
)

/**
 * 占位符只在**两处都为空**时出现：
 * · prompt（外部 modelValue）为空；
 * · 编辑器里也没有任何文字（两者不同步的下一拍就不会叠字）。
 * 另外 AI 正在写入时不显示（那时输入框里马上会来内容）。
 */
const showPlaceholder = computed(
  () => props.prompt.length === 0 && editorEmpty.value && props.aiPhase === 'idle',
)
</script>

<template>
  <div class="nb-editor nodrag nopan nowheel" :style="editorStyle">
    <!-- starting 阶段提示（原文还在，只是右上角小字说一句，不遮内容） -->
    <span v-if="aiPhase === 'starting'" class="nb-ai-hint" aria-hidden="true">AI 处理中，即将写入…</span>
    <!--
      占位符：只有「输入框真的空」才画。
      用户 2026-11-10 的叠字就是这里出的 —— prompt 已经是空串、但 ProseMirror 里
      还留着内容（外部同步是 watch 下一拍才替换），于是占位符和正文同时画在左上角。
      现在额外要求编辑器文档为空（editorEmpty），两者都为真才显示。
    -->
    <span
      v-if="showPlaceholder"
      class="nb-placeholder"
      aria-hidden="true"
    >描述你想要的内容，可用 @ 引用素材</span>
    <ProseMirrorEditor
      ref="editorComponentRef"
      :model-value="prompt"
      v-model:prompt-doc="promptDocModel"
      :resources="editorResources"
      :resolve-resource="resolveResource"
      :editable="!aiEditorLocked"
      :on-paste-files="onPasteFiles"
      @update:model-value="(v: string) => emit('update', v)"
      @click.stop
    />
    <slot name="tag-menu" />
  </div>
</template>
