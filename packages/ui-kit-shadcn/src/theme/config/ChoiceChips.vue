<script setup lang="ts">
/**
 * ChoiceChips —— 圆角 / 尺寸这类"一眼对比"的单选组。
 *
 * 两组共用同一套尺寸（h-9、20×20 预览框），保证并排时行高一致。
 * 预览框内部形状由 paint 决定，框本身固定 —— 否则换档位时整格会跳。
 */
import { RadioGroup, RadioGroupItem } from '@/previewKit'
import type { ChoiceOption } from './types'

defineProps<{
  modelValue: string
  options: ChoiceOption[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// 6 列后每格很窄：去掉了 RadioGroupItem 的圆点，
// 用「预览形状 + 短标签」本身表达选中（选中铺底 + 深字），避免选项折成两行。
const CHIP =
  'flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-2 text-xs transition-colors hover:bg-muted/60'

function chipClass(active: boolean): string {
  return active ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground'
}
</script>

<template>
  <RadioGroup
    :model-value="modelValue"
    class="flex flex-wrap gap-1.5"
    @update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
  >
    <label
      v-for="o in options"
      :key="o.value"
      :title="o.title ?? o.label"
      :class="[CHIP, chipClass(modelValue === o.value)]"
    >
      <RadioGroupItem :value="o.value" class="sr-only" />
      <!-- 固定 20×20 的框：里面画档位对应的形状，行高才不会跳 -->
      <span class="flex size-5 flex-none items-center justify-center" aria-hidden="true">
        <span
          v-if="o.kind === 'radius'"
          class="size-4 border-2 border-current"
          :style="{ borderRadius: o.paint }"
        />
        <span v-else class="w-4 border-2 border-current" :style="{ height: o.paint, borderRadius: '2px' }" />
      </span>
      <span>{{ o.label }}</span>
    </label>
  </RadioGroup>
</template>
