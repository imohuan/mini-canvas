<script setup lang="ts">
/**
 * 项目页里的素材库入口（旧卡片形态，保留给需要「两个按钮」的宿主）。
 *
 * 成品应用现在把风格库 / 特效库注册成左栏整页页签（见 index.ts 的 app.projects.tabs），
 * 这张卡片不再挂在项目页上；保留导出是为了不破坏已有引用与外部宿主。
 */
import { computed } from 'vue'
import { SparklesIcon, WandSparklesIcon } from 'lucide-vue-next'
import { useCanvasContext, useUiComponent } from '@mini-canvas/canvas-render'
import type { LibraryService } from '../data/store'
import { useCanvasGate } from '../useCanvasGate'

const { ctx } = useCanvasContext()
const Button = useUiComponent('Button')
const gate = useCanvasGate(ctx, '素材')

function open(name: 'style-library' | 'effect-library'): void {
  const svc = ctx.tryGet<LibraryService>(name)
  svc?.open()
}
</script>

<template>
  <div class="rounded-2xl border border-line bg-panel p-4">
    <div class="text-sm font-medium text-ink">素材库</div>
    <p class="mt-2 text-xs text-ink-dim">在项目页也可以浏览；加入画布需要先打开一张画布。</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <component :is="Button" variant="outline" @click="open('style-library')">
        <SparklesIcon :size="14" /> 风格库
      </component>
      <component :is="Button" variant="outline" @click="open('effect-library')">
        <WandSparklesIcon :size="14" /> 特效库
      </component>
    </div>
    <p v-if="!gate.canUse.value" class="mt-2 text-xs text-ink-dim">{{ gate.reason.value }}</p>
  </div>
</template>
