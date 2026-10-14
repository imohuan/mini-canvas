<script setup lang="ts">
/**
 * 渲染实验：验证文档站能否直接跑 `@mini-canvas/plugin-theme-default` 里的组件。
 * 目前只探"纯 UI 件"（不依赖画布渲染上下文的那些）。
 */
import { NodeToolbarButton, Tooltip, Select, PrecisionSlider, ColorField } from '@mini-canvas/plugin-theme-default'

const options = [
  { label: '快速', value: 'fast' },
  { label: '精细', value: 'fine' },
]
</script>

<template>
  <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center">
    <NodeToolbarButton title="下载" variant="primary">下载</NodeToolbarButton>
    <NodeToolbarButton title="删除" variant="danger">删除</NodeToolbarButton>
    <NodeToolbarButton title="图标钮" icon="★" />
    <Tooltip content="这是一条气泡提示">
      <NodeToolbarButton title="悬停我" icon="?" />
    </Tooltip>
    <Select :options="options" model-value="fast" />
    <PrecisionSlider :model-value="50" :min="0" :max="100" aria-label="数值" />
    <ColorField model-value="#3b82f6" />
  </div>
</template>
