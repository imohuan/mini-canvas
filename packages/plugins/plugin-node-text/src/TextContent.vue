<script setup lang="ts">
// TextContent —— text 节点 content 组件（随 plugin-node-text 插件包发布，经 BaseNode 壳的 content 段渲染）
// 职责：展示文本；双击进入编辑，失焦/回车把改动经 ctx.text.editText 写回内核并落盘。
// 依赖方向：只 import 渲染层的 useCanvasRender()(收口函数)，不反向依赖 demo-web。
import { ref, nextTick, onBeforeUnmount } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const props = defineProps<{ id: string; data: { text?: string } }>()

// 统一渲染上下文经 useCanvasRender() 取(宿主 provide)；ctx 是裸内核上下文(boot 后已就绪，见 CanvasSurface)。
// ctx.text 的类型来自本插件对 Context 的 declare module 增强(nodeTextPlugin.ts)。
const { ctx } = useCanvasRender()
function textService() {
  return ctx.text
}

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
// 本地展示值：init 自 props.data，编辑后本地回显
const shown = ref(props.data.text ?? '')

function startEdit(): void {
  draft.value = shown.value
  editing.value = true
  void nextTick(() => inputEl.value?.focus())
}

function commit(): void {
  if (!editing.value) return
  editing.value = false
  const next = draft.value
  if (next !== shown.value) {
    shown.value = next
    textService().editText(props.id, next)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commit()
  } else if (e.key === 'Escape') {
    editing.value = false
  }
}

function stop(e: MouseEvent): void {
  e.stopPropagation()
}
onBeforeUnmount(() => {
  if (editing.value) {
    editing.value = false
    const next = draft.value
    if (next !== shown.value) textService().editText(props.id, next)
  }
})
</script>

<template>
  <div class="text-node">
    <div class="body" @dblclick.stop="startEdit" :title="'双击编辑'">
      <textarea
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        class="editor"
        @blur="commit"
        @keydown="onKeydown"
        @click.stop="stop"
        @mousedown.stop="stop"
      ></textarea>
      <div v-else class="preview">{{ shown || '（空）' }}</div>
    </div>
  </div>
</template>

<style scoped>
.text-node {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  padding: 8px 10px;
  overflow: hidden;
}
.preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.5;
  cursor: text;
}
.editor {
  width: 100%;
  height: 100%;
  min-height: 80px;
  resize: none;
  border: 1px solid #2563eb;
  border-radius: 4px;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 4px 6px;
  outline: none;
}
</style>
