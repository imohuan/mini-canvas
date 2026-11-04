<script setup lang="ts">
/**
 * 项目页的插件面板区。
 *
 * 这是 ui-shell 提供的固定插槽（app.projects.main），插件只往这里注册内容；
 * 项目页不直接认识任何插件。没有注册项时整块不占位，页面保持原样。
 */
import { SlotHost } from '@mini-canvas/canvas-render'

defineProps<{ hidden?: boolean }>()
</script>

<template>
  <section v-if="!hidden" class="mt-6" data-projects-panel="main">
    <SlotHost slot="app.projects.main" />
  </section>
</template>
