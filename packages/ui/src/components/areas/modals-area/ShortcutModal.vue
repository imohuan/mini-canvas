<script setup lang="ts">
import { motion } from 'motion-v'
import { X } from 'lucide-vue-next'
import { useUi } from '../../../composables/ui'
import { useShortcutPanel } from './useShortcutPanel'

const ui = useUi()
const s = ui.state

const emit = defineEmits<{ close: [] }>()

const { shortcutPanelRef, arrowShift } = useShortcutPanel(
  () => s.shortcutsOpen,
  () => emit('close'),
)

function closeShortcutPanel(): void {
  emit('close')
}
</script>

<template>
  <!-- 快捷键：毛玻璃，相对**整个视口**居中；底部箭头指向 dock 的「快捷键」按钮（中轴对齐） -->
  <div v-if="s.shortcutsOpen" class="fixed inset-0 z-[90] flex flex-col items-center justify-end overflow-y-auto pb-[74px] pt-6">
    <motion.section
      ref="shortcutPanelRef"
      class="shortcut-modal relative flex max-h-[calc(100vh-110px)] w-[min(1152px,calc(100vw-48px))] flex-col rounded-2xl border border-line bg-glass text-ink shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-[28px] backdrop-saturate-[1.4]"
      role="dialog" aria-modal="true" aria-label="快捷键" :initial="{ opacity: 0, scale: 0.96, y: 8 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }" :transition="{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }"
      @pointerdown.stop>
      <div class="grid min-h-10 grid-cols-4 items-center gap-x-6 pl-5 pr-[42px] mr-[10px]">
        <h4 v-for="col in ui.shortcuts" :key="col.group" class="text-xs font-bold text-brand">{{ col.group }}</h4>
        <button
          class="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
          aria-label="关闭快捷键面板" @click="closeShortcutPanel">
          <X :size="15" />
        </button>
      </div>
      <div
        class="grid min-h-0 flex-1 content-start grid-cols-4 gap-x-6 gap-y-1 overflow-y-auto pb-5 pl-5 pr-[42px] mr-[10px]">
        <div v-for="col in ui.shortcuts" :key="col.group" class="shortcut-col">
          <div v-for="row in col.items" :key="row[0]"
            class="flex min-h-[34px] items-center justify-between gap-2.5 text-xs text-ink">
            <span>{{ row[0] }}</span>
            <span class="flex items-center gap-1"><template v-for="(k, i) in row[1]" :key="k + i"><kbd
                  class="rounded-md border border-line bg-veil px-1.5 py-0.5 text-[10px] text-ink">{{ k }}</kbd><em
                  v-if="i < row[1].length - 1" class="not-italic text-ink-dim">+</em></template></span>
          </div>
        </div>
      </div>
    </motion.section>
    <span
      class="relative z-[1] -mt-[7px] size-[14px] rounded-[3px] border-b border-r border-line bg-arrow backdrop-blur-[28px] backdrop-saturate-[1.4]"
      :style="{ transform: `translateX(${arrowShift}px) rotate(45deg)` }" aria-hidden="true"></span>
  </div>
</template>
