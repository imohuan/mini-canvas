<script setup lang="ts">
import { provide } from 'vue'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '@mini-canvas/canvas-render'
import ThemeStudio from './ThemeStudio.vue'
import { createStudioPreviewContext, createStudioPreviewSource } from './themeStudioPreview'

// 这个独立页服务「目验 ThemeStudio」：不再挂旧的 ThemeLab 画布工作台，
// 否则两套界面叠在一起，看不出设置页里真正的效果。
const { source } = createStudioPreviewSource()

// 提供真实画布上下文：预览图层经 ctx.slots 注册，和设置页同一个 SlotHost 渲染。
const previewCtx = createStudioPreviewContext()
provide(CANVAS_CONTEXT_KEY, { ctx: previewCtx } as unknown as CanvasContext)
</script>

<template>
  <div class="theme-lab-page">
    <div class="theme-studio-shell">
      <ThemeStudio :settings-source="source" />
    </div>
  </div>
</template>
