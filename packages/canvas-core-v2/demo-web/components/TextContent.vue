<script setup lang="ts">
// TextContent —— text 节点 content 组件（经 BaseNode 壳的 content 段渲染）
// 职责：展示文本；双击进入编辑，失焦/回车把改动经 ctx.get('text').editText 写回内核并落盘。
// 连接点 Handle 由 BaseNode 壳统一提供，这里不再自带。
import { inject, ref, nextTick, onBeforeUnmount } from 'vue'
import { HOST_KEY } from '../demoInjection'
import type { TextNodeService } from '../../src/plugins/nodeText'
import type { CanvasHost } from '../../src/demo/host'

const props = defineProps<{ id: string; data: { text?: string } }>()

const hostRef = inject(HOST_KEY)
function host(): CanvasHost {
  const h = hostRef?.value
  if (!h) throw new Error('[TextContent] 宿主未就绪（boot 未完成）')
  return h
}

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
// 本地展示值：init 自 props.data，编辑后本地回显（内核节点与 VueFlow 节点是两份拷贝，
// 直接读 props.data.text 在写回内核后不会自动刷新，故用本地值兜底回显）
const shown = ref(props.data.text ?? '')

function textService(): TextNodeService {
  return host().ctx.get<TextNodeService>('text')
}

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
    // 写回内核 + 落盘（只在真变时）
    textService().editText(props.id, next)
  }
}

function onKeydown(e: KeyboardEvent): void {
  // Enter 提交，Shift+Enter 换行，Esc 取消
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commit()
  } else if (e.key === 'Escape') {
    editing.value = false
  }
}

function stop(e: MouseEvent): void {
  // 双击进入编辑时不要把这次双击再当成节点选中拖动的起点
  e.stopPropagation()
}
onBeforeUnmount(() => {
  // 组件被删/卸载时若还在编辑，强制落一次盘，避免丢最后一行
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
