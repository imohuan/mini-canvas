<script setup lang="ts">
// 文件：packages/docs/public/examples/packages\docs\public\examples\node-factory\plugin-sticky-demo\src\src/StickyContent.vue
// 格式：Vue 单文件组件（setup 语法糖）
// 位置：sticky 节点卡片内部（in 区域）渲染的内容
import { ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

// ① 区域组件收到的 props 固定是 { id, data }（壳 BaseNode 传的）
const props = defineProps<{ id: string; data: { text?: string } }>()
const { ctx } = useCanvasRender()

const draft = ref(props.data.text ?? '')
// ② 外部改动（撤销/重做、别的插件）也要同步回本地的显示值
watch(() => props.data.text, (next) => (draft.value = next ?? ''))

// ③ 写回走 doc 门面（唯一写入口：进历史 + 落盘）
function commit(): void {
  ctx.get('doc').updateNode(props.id, { data: { text: draft.value } })
}
</script>

<template>
  <div class="sticky-content">
    <textarea v-model="draft" @blur="commit" @keydown.escape="commit" />
  </div>
</template>

<style scoped>
.sticky-content {
  padding: 8px;
  height: 100%;
}
.sticky-content textarea {
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
}
</style>

