<script setup lang="ts">
/**
 * 渲染实验：验证文档站能否直接跑 `@plume-canvas/plugin-theme-components` 里的组件。
 * 目前只探"纯 UI 件"（不依赖画布渲染上下文的那些）。
 */
import { PrecisionSlider, ColorField } from '@plume-canvas/plugin-theme-components'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@plume-canvas/ui-kit-shadcn'

const options = [
  { label: '快速', value: 'fast' },
  { label: '精细', value: 'fine' },
]
</script>

<template>
  <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center">
    <Button class="pk-toolbar-btn pk-toolbar-btn--primary" variant="default" size="sm" type="button" title="下载">下载</Button>
    <Button class="pk-toolbar-btn pk-toolbar-btn--danger" variant="destructive" size="sm" type="button" title="删除">删除</Button>
    <Button class="pk-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="图标钮" aria-label="图标钮">★</Button>
    <TooltipProvider :delay-duration="120">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button class="pk-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="悬停我" aria-label="悬停我">?</Button>
        </TooltipTrigger>
        <TooltipContent side="top">这是一条气泡提示</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <Select model-value="fast">
      <SelectTrigger size="sm" style="width: 120px"><SelectValue placeholder="选择" /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
      </SelectContent>
    </Select>
    <PrecisionSlider :model-value="50" :min="0" :max="100" aria-label="数值" />
    <ColorField model-value="#3b82f6" />
  </div>
</template>
