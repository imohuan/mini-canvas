<script setup lang="ts">
/**
 * 项目页「组件库」整页。
 *
 * 组件库展厅由默认主题登记进 ui 目录（名字 componentShowcase），这里只按名取件 ——
 * 外壳不直接 import @mini-canvas/ui-kit-shadcn，换主题时也会跟着换。
 */
import { useUiComponent } from '@mini-canvas/canvas-render'

const Showcase = useUiComponent('componentShowcase')
</script>

<template>
  <component :is="Showcase" v-if="Showcase" embedded />
  <p v-else class="px-6 py-10 text-center text-[13px] text-ink/50">
    主题没有提供组件展厅（ui 目录里缺少 componentShowcase）。
  </p>
</template>
