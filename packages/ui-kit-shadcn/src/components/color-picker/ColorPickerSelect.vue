<script lang="ts" setup>
/**
 * 取色器里的「格式」下拉。
 *
 * 原来这里自己用 reka 拼了一个：写死 24px 高、5px 圆角、白底、浅色边框、
 * 面板底色写死 #1e1e1e —— 暗色主题下整个面板是白的，字又几乎看不见
 * （用户 2026-11-04 截图反馈）。
 *
 * 现在直接用组件库自己的 Select：触发器、面板、选项、勾选、暗色配色
 * 全部跟其它下拉一致，也不再单独写死颜色。尺寸用 sm，和取色器里的小控件齐平。
 */
// 取色器是组件库内部件，直接引用同库的 Select（相对路径，不经预览页的薄层）。
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

const props = defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
  class?: string
  options?: string[]
  modelValue?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <Select
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="(v) => emit('update:modelValue', String(v ?? ''))"
  >
    <SelectTrigger
      size="sm"
      :aria-label="props.label"
      :class="['w-16 justify-between px-2 text-xs *:data-[slot=select-value]:text-foreground', props.class]"
    >
      <SelectValue :placeholder="props.placeholder" />
    </SelectTrigger>
    <SelectContent position="popper" side="bottom" :side-offset="4" class="min-w-[96px]">
      <SelectItem v-for="option in props.options" :key="option" :value="option">
        {{ option }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
