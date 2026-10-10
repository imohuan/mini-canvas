<!-- 文件：packages/docs/public/examples/node-registry/plugin-counter-badge/src/CounterContent.vue -->
<!-- 格式：Vue 单文件组件（节点卡片的"内容区"组件，落区域词 in） -->
<!-- 位置：插件包内的展示组件，由 index.ts 经 ctx.nodes.register 的 in 字段挂上去 -->

<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

/** 外壳（BaseNode）注入的两个 props：节点 id 与节点数据 */
const props = defineProps<{ id: string; data: Record<string, unknown> }>()

// 内容组件在渲染子树里，用 useCanvasRender() 拿内核 ctx（裸值，不用判空）
const { ctx } = useCanvasRender()

const count = computed(() => (typeof props.data.count === 'number' ? props.data.count : 0))

/** 加一：走 doc 的唯一写入口（自动进撤销 + 自动落盘） */
function bump() {
  ctx.get('doc').updateNode(props.id, { data: { ...props.data, count: count.value + 1 } })
}
</script>

<template>
  <div class="counter">
    <span class="counter__num">{{ count }}</span>
    <button type="button" @click="bump">+1</button>
  </div>
</template>

<style scoped>
.counter {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
}
.counter__num {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}
</style>

