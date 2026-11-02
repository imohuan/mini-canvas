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
  resolveResource: (id: string) => ResourceItem | undefined
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
</script>

<template>
  <div class="nb-editor nodrag nopan nowheel" :style="editorStyle">
    <!-- starting 阶段提示（原文还在，只是右上角小字说一句，不遮内容） -->
    <span v-if="aiPhase === 'starting'" class="nb-ai-hint" aria-hidden="true">AI 处理中，即将写入…</span>
    <span v-if="prompt.length === 0 && aiPhase === 'idle'" class="nb-placeholder" aria-hidden="true">描述你想要的内容，可用 @ 引用素材</span>
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
