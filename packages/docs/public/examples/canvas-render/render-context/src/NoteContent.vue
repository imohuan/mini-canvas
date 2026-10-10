<!-- 文件：packages/docs/public/examples/canvas-render/render-context/src/NoteContent.vue -->
     格式：Vue 单文件组件（节点 content 组件，被节点壳按 type 路由渲染）
     位置：插件包内部；它只知道「我是某个节点的内容」，不知道壳是谁 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

// ① 壳注进来的两个 props：id 与 data（响应式对象引用）
const props = defineProps<{ id: string; data: { text?: string } }>()

// ② 写回回调 + 只读数据源：都从渲染上下文来
const { nodeWrite, flow } = useCanvasRender()

// ③ 本地展示值：初值来自 props.data，外部改（撤销 / 重做 / AI 写回）时跟着变
const shown = ref(props.data.text ?? '')
watch(() => props.data.text, (next) => { shown.value = typeof next === 'string' ? next : '' })

// ④ 编辑态：本地草稿，失焦提交（避免每敲一个字就写一次历史）
const editing = ref(false)
const draft = ref('')
function startEdit() { draft.value = shown.value; editing.value = true }
function commit() {
  editing.value = false
  if (draft.value === shown.value) return
  shown.value = draft.value
  nodeWrite(props.id, { text: draft.value })   // ⑤ 写回：宿主内置实现 → graph.updateNode → 历史 + 落盘
}

// ⑥ 缩放：flow.viewport 是响应式 Ref，缩到很小的时候换 LOD 渲染
const zoom = computed(() => Math.max(flow.viewport.value?.zoom ?? 1, 0.01))
const tooSmall = computed(() => zoom.value < 0.18)
</script>

<template>
  <div class="note">
    <!-- ⑦ LOD：太小就只画灰条，省重绘 -->
    <div v-if="tooSmall" class="note-skel" />

    <textarea
      v-else-if="editing"
      v-model="draft"
      class="note-editor nowheel nodrag nopan"
      aria-label="便签内容"
      @blur="commit"
      @wheel.stop
      @mousedown.stop
    />

    <div v-else class="note-preview" title="双击编辑" @dblclick.stop="startEdit">
      {{ shown || '（空）' }}
    </div>
  </div>
</template>

<style scoped>
.note { box-sizing: border-box; width: 100%; height: 100%; padding: 12px; overflow: hidden; }
.note-preview { width: 100%; height: 100%; white-space: pre-wrap; overflow: hidden; cursor: text; }
.note-editor {
  display: block; box-sizing: border-box; width: 100%; height: 100%;
  padding: 0; border: none; outline: none; background: transparent; resize: none;
  font: inherit; overflow-y: auto;
}
.note-skel { width: 100%; height: 100%; background: var(--canvas-node-surface, rgba(0, 0, 0, 0.04)); }
</style>
