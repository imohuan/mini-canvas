<script setup lang="ts">
/**
 * PaintColorPicker —— 绘制工具栏的「标记颜色」下拉。
 *
 * 面板本身已抽到默认主题的 `colorSwatchPicker`（用户口径 2026-11-15：分组背景色要
 * 与这里完全一致）。本文件只剩一件事：把 ui 目录里的那个件取出来，接上会话色值，
 * 保持「图标态触发器」的工具栏外观。
 */
import { useUiComponent } from '@plume-canvas/canvas-render'

const props = defineProps<{
  /** 当前颜色（#rrggbb / #rrggbbaa） */
  modelValue: string
}>()

const emit = defineEmits<{
  /** 选色（预置色或取色器都会发） */
  (e: "update:modelValue", value: string): void
}>()

const ColorSwatchPicker = useUiComponent('colorSwatchPicker')
</script>

<template>
  <component
    :is="ColorSwatchPicker"
    v-if="ColorSwatchPicker"
    :model-value="props.modelValue"
    label="标记颜色"
    trigger="icon"
    @update:model-value="(v: string) => emit('update:modelValue', v)"
  />
</template>
