<script setup lang="ts">
/**
 * SlotDebugPopover —— 插槽调试小点的悬停说明面板（默认主题提供）。
 *
 * 为什么放在主题插件：它是**默认皮的一部分**（外观与文案都跟主题走），
 * 与 Dropdown / Tooltip / NodeToolbarButton 同一类"设计系统件"。
 * canvas-render 只负责发出"这里有个点、内容是什么"，不决定长什么样。
 *
 * 实现直接用本包的 Dropdown（trigger=hover）：与全站下拉共用定位、翻转、
 * 点击外部关闭与箭头，不另造一套浮层。
 */
import { computed } from 'vue'
import Dropdown from './Dropdown.vue'

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
  <Dropdown trigger="hover" placement="top" :offset="8" :hover-close-delay="120" menu-width="max-content"
    body-class="sdp-body">
    <template #trigger>
      <slot />
    </template>
    <dl class="sdp-list">
      <template v-for="(row, i) in rows" :key="i">
        <template v-if="row.key">
          <dt>{{ row.key }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
        <dd v-else class="sdp-note">{{ row.value }}</dd>
      </template>
    </dl>
  </Dropdown>
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
