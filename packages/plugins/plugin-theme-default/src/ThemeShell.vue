<script setup lang="ts">
// ThemeShell —— 主题插件提供的节点外壳组件（示例，替换宿主默认 BaseNode 壳）。
// 契约(见 docs/tmp/vueflow-contract)：nodeTypes 值给本组件，vue-flow 透传 NodeProps。
//  - 端口 Handle 必须真实渲染在节点根内才能连线 → 这里放左 target/右 source 两个 Handle。
//  - 选中态 class 是 vue-flow 加在外框 .vue-flow__node，本组件根要用 selected prop 自加样式。
//  - 中间内容：按 props.type 经注入的 nodeRegistry 解析 content 组件渲染（业务插件注册）。
import { computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'
import { NODE_REGISTRY_KEY } from '@mini-canvas/canvas-core-v2'

const props = defineProps<NodeProps>()

const registry = inject(NODE_REGISTRY_KEY)
const content = computed(() => {
  const def = registry?.get(props.type as string)
  return def?.segments.content
})
const label = computed(() => String((props.data as { label?: string })?.label ?? props.type))
</script>

<template>
  <div class="theme-shell" :class="{ selected: selected }">
    <!-- 端口：target 左 / source 右（真实 Handle，供连线寻址） -->
    <Handle id="target" type="target" :position="Position.Left" class="port" />
    <div class="title">{{ label }}</div>
    <div class="body">
      <component :is="content" v-if="content" :id="id" :data="data" />
      <div v-else class="empty">type "{{ type }}" 无 content</div>
    </div>
    <Handle id="source" type="source" :position="Position.Right" class="port" />
  </div>
</template>

<style scoped>
.theme-shell {
  position: relative;
  min-width: 160px;
  border: 2px solid #7c3aed;
  border-radius: 10px;
  background: #f5f3ff;
  font-family: system-ui, sans-serif;
}
.theme-shell.selected {
  border-color: #db2777;
  box-shadow: 0 0 0 3px rgba(219, 39, 119, 0.25);
}
.title {
  padding: 4px 10px;
  font-size: 11px;
  color: #6d28d9;
  border-bottom: 1px solid #ddd6fe;
}
.body {
  padding: 6px 10px;
}
.empty {
  color: #a855f7;
  font-size: 12px;
}
.port {
  width: 10px;
  height: 10px;
  background: #7c3aed;
  border: 2px solid #fff;
}
</style>
