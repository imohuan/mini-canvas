<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { computed, ref } from 'vue'

const props = defineProps<NodeProps>()
const text = ref((props.data?.text as string) || '双击编辑文本...')
const editing = ref(false)

const { viewport } = useVueFlow('main-canvas')

const zoom = computed(() => Math.max(viewport.value.zoom || 1, 0.01))
const contentScaleStyle = computed(() => ({
  width: `${zoom.value * 100}%`,
  height: `${zoom.value * 100}%`,
  transform: `scale(${1 / zoom.value}) translateZ(0)`,
  transformOrigin: 'top left',
  fontSize: `${14 * zoom.value}px`,
}))

function startEdit() {
  editing.value = true
}
function finishEdit() {
  editing.value = false
}
</script>

<template>
  <div class="w-full h-full p-4 overflow-hidden">
    <textarea
      v-show="editing"
      v-model="text"
      class="text-node-content w-full h-full resize-none border-none outline-none bg-transparent text-gray-700 leading-relaxed"
      :style="contentScaleStyle"
      placeholder="输入文本..."
      @blur="finishEdit"
      @keydown.escape="finishEdit"
      autofocus
    />
    <div
      v-show="!editing"
      class="text-node-content w-full h-full text-gray-700 leading-relaxed whitespace-pre-wrap overflow-hidden cursor-text"
      :style="contentScaleStyle"
      @dblclick="startEdit"
    >
      {{ text }}
    </div>
  </div>
</template>

<style scoped>
.text-node-content {
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  backface-visibility: hidden;
  will-change: transform, font-size;
}
</style>
