<script setup lang="ts">
/**
 * ThemeRadiusField —— 「外观 → 形状」的圆角单选。
 *
 * 和组件库预览页顶部那组一样：每一档左边一个圆点、中间一段「直线→圆弧→直线」的
 * 转角示意、右边一个短标签。圆角这种要横向对比的档位，铺开选比塞进下拉更直观。
 *
 * 最前面保留「跟随项目」：不写变量，回到项目原有的 8px 控件圆角。
 */
import { computed } from 'vue'
import { useUiComponentOutside } from '../../composables/useUiComponentOutside'
import {
  THEME_RADIUS_CHOICES,
  THEME_RADIUS_LABELS,
  THEME_RADIUS_VALUES,
} from '@plume-canvas/theme-contract'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const Button = useUiComponentOutside('Button')

interface RadiusChoice {
  id: string
  /** 胶囊里的短标签（数值放进 title，胶囊里放不下） */
  short: string
  /** 完整说明，鼠标悬停时给 */
  title: string
  /** 真实像素值，用来画弧 */
  px: number
}

/** `0.375rem` → 6（px）；`inherit` 不写值 → 0 */
function toPx(id: string): number {
  const match = /^([\d.]+)rem$/.exec(THEME_RADIUS_VALUES[id] ?? '')
  return match ? Number(match[1]) * 16 : 0
}

const choices = computed<RadiusChoice[]>(() =>
  THEME_RADIUS_CHOICES.map((id) => ({
    id,
    short: id === 'inherit' ? '跟随' : (THEME_RADIUS_LABELS[id] ?? id).split('（')[0]!,
    title: THEME_RADIUS_LABELS[id] ?? id,
    px: toPx(id),
  })),
)

/** 和预览页一样的转角 path：M 左下 → L 上 → 弧 → L 右 */
function arcPath(px: number, box = 26): string {
  const r = Math.max(0, Math.min(px, box / 2))
  return r === 0 ? `M 0,${box} L 0,0 L ${box},0` : `M 0,${box} L 0,${r} A ${r},${r} 0 0,1 ${r},0 L ${box},0`
}

</script>

<template>
  <div class="trf-chips" role="group" aria-label="圆角档位">
    <Button
      v-for="choice in choices"
      :key="choice.id"
      type="button"
      :variant="modelValue === choice.id ? 'secondary' : 'ghost'"
      :title="choice.title"
      :aria-pressed="modelValue === choice.id"
      class="trf-chip"
      @click="emit('update:modelValue', choice.id)"
    >
      <span class="trf-preview" aria-hidden="true">
        <svg viewBox="0 0 26 26" width="26" height="26" fill="none">
          <path
            :d="arcPath(choice.px)"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span>{{ choice.short }}</span>
    </Button>
  </div>
</template>

<style scoped>
.trf-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
}

.trf-chip {
  width: auto;
  gap: 6px;
  padding: 0 6px;
  font-size: 12px;
}

.trf-preview {
  display: flex;
  width: 20px;
  height: 20px;
  flex: none;
  align-items: center;
  justify-content: center;
}

.trf-preview svg {
  width: 20px;
  height: 20px;
}
</style>
