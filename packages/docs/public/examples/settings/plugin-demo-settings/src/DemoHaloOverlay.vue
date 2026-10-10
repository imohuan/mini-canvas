<!-- 文件：packages/docs/public/examples/settings/plugin-demo-settings/src/DemoHaloOverlay.vue -->
     格式：Vue 单文件组件（挂在 overlay 槽里）
     位置：插件包内部；只收 props、画东西，不直接读服务 -->
<script setup lang="ts">
defineProps<{
  enabled: boolean
  size: number
}>()
</script>

<template>
  <!-- 开关关掉时什么都不画（这是"配置实时生效"的可视证据） -->
  <div
    v-if="enabled"
    class="demo-halo"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
</template>

<style scoped>
.demo-halo {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(59, 130, 246, 0.6);
  pointer-events: none;
}
</style>

