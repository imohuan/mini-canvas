<script setup lang="ts">
/**
 * ThemeSizeField —— 「外观 → 尺寸」的控件尺寸单选。
 *
 * 和组件库预览页顶部那组一致：每一项左侧圆点、中间画一个该档位的方块高度、
 * 右侧写「小 / 标准 / 大」。最前面保留「跟随组件默认」（各组件的 size prop 各管各的）。
 *
 * 方块高度只是**示意**（6 / 10 / 14px，装在同一尺寸的框里居中），
 * 不参与布局；真实高度由组件库 size 档位决定。
 */
import { computed } from 'vue'
import { useUiComponentOutside } from '../../composables/useUiComponentOutside'
import { THEME_SIZE_CHOICES, THEME_SIZE_HINTS, THEME_SIZE_LABELS } from '@mini-canvas/theme-contract'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const Button = useUiComponentOutside('Button')

interface SizeChoice {
  id: string
  short: string
  title: string
  /** 示意方块高度（px） */
  blockHeight: number
}

/** 三档互相差 4px：缩略图看得出层次，又不会把行撑高 */
const BLOCK_HEIGHT: Readonly<Record<string, number>> = { sm: 6, default: 10, lg: 14 }

const choices = computed<SizeChoice[]>(() =>
  THEME_SIZE_CHOICES.map((id) => ({
    id,
    short: id === 'inherit' ? '跟随' : (THEME_SIZE_LABELS[id] ?? id),
    title: [THEME_SIZE_LABELS[id] ?? id, THEME_SIZE_HINTS[id]].filter(Boolean).join(' · '),
    blockHeight: BLOCK_HEIGHT[id] ?? 10,
  })),
)
</script>

<template>
  <div class="tsf-chips" role="group" aria-label="控件尺寸档位">
    <Button
      v-for="choice in choices"
      :key="choice.id"
      type="button"
      :variant="modelValue === choice.id ? 'secondary' : 'ghost'"
      :title="choice.title"
      :aria-pressed="modelValue === choice.id"
      class="tsf-chip"
      @click="emit('update:modelValue', choice.id)"
    >
      <span class="tsf-preview" aria-hidden="true">
        <span
          class="tsf-block"
          :style="{ height: choice.blockHeight + 'px' }"
        />
      </span>
      <span>{{ choice.short }}</span>
    </Button>
  </div>
</template>

<style scoped>
.tsf-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
}

.tsf-chip {
  width: auto;
  gap: 6px;
  padding: 0 6px;
  font-size: 12px;
}

/* 20×20 的固定框：里面只换方块高度，行高恒定 */
.tsf-preview {
  display: flex;
  width: 20px;
  height: 20px;
  flex: none;
  align-items: center;
  justify-content: center;
}

.tsf-block {
  display: block;
  width: 16px;
  border: 2px solid currentColor;
  border-radius: 2px;
}
</style>
