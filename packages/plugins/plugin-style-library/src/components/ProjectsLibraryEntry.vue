<script setup lang="ts">
/**
 * 项目页里的素材库入口（app.projects.main）。
 *
 * 只做两个按钮：打开风格库 / 特效库。真正的广场是应用级 overlay 组件，
 * 没进画布也能浏览；「使用」在缺画布能力时禁用并提示。
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
