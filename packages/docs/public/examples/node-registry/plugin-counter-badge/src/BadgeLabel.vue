<!-- 文件：packages/docs/public/examples/node-registry/plugin-counter-badge/src/BadgeLabel.vue -->
<!-- 格式：Vue 单文件组件（叠在节点某个区域的组件，落区域词 title） -->
<!-- 位置：插件包内的展示组件，由 index.ts 经 ctx.nodes.attach 挂到所有节点上 -->

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

/** 只给"计数器"节点显示，别的类型返回空串（组件自己判类型，比在注册处写条件更简单） */
const shown = computed(() => typeof props.data.count === 'number')
const text = computed(() => (shown.value ? '已计 ' + String(props.data.count) + ' 次' : ''))
</script>

<template>
  <span v-if="shown" class="badge">{{ text }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--ui-chip, rgba(0, 0, 0, 0.06));
  color: var(--ui-ink-dim, #64748b);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
}
</style>

