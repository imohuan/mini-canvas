<script setup lang="ts">
/**
 * SlotDebugPopover —— 插槽调试的悬停说明面板（保留给自定义宿主复用）。
 *
 * 现行默认实现是 SlotDebugOverlay（全局挂一次、读 data-slot / data-slot-id），
 * 本组件不再被 SlotComposer 引用；保留它是为了让别的宿主也能拿这一份面板。
 *
 * 实现用 shadcn 的 Tooltip（悬停触发）：定位、翻转、视口收边都由组件库负责。
 */
import { computed } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@plume-canvas/ui-kit-shadcn'

const props = defineProps<{
  /** 多行文本，每行形如 "key: value" */
  content?: string
}>()

interface Row {
  key: string
  value: string
}

const rows = computed<Row[]>(() =>
  String(props.content ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':')
      if (idx < 0) return { key: '', value: line }
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
    }),
)
</script>

<template>
  <TooltipProvider :delay-duration="120">
    <Tooltip>
      <TooltipTrigger as-child>
      <slot />
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="8" class="sdp-body">
        <dl class="sdp-list">
      <template v-for="(row, i) in rows" :key="i">
        <template v-if="row.key">
          <dt>{{ row.key }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
        <dd v-else class="sdp-note">{{ row.value }}</dd>
      </template>
        </dl>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style>
/* 非 scoped：菜单被 Teleport 到 body，scoped 命不中 */
.sdp-body {
  padding: 8px 10px;
  min-width: 190px;
  max-width: 330px;
}
.sdp-list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 10px;
  margin: 0;
  font: 500 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  text-align: left;
}
.sdp-list dt {
  color: var(--ui-ink-mute, #8c95a3);
}
.sdp-list dd {
  margin: 0;
  color: var(--ui-ink, #18202b);
  word-break: break-all;
}
.sdp-note {
  grid-column: 1 / -1;
  white-space: pre-wrap;
}
</style>
