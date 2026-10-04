<script setup lang="ts">
// 轻量 Markdown 渲染：内容先转义再拼标签（见 markdown.ts 的 XSS 说明）。
import { computed } from 'vue'
import { renderMarkdown } from '../markdown.js'

const props = defineProps<{ text: string }>()
const html = computed(() => renderMarkdown(props.text))
</script>

<template>
  <div class="md" v-html="html"></div>
</template>

<style scoped>
.md { font-size: 12px; line-height: 1.65; color: var(--ui-ink); word-break: break-word; }
.md :deep(.md-p) { margin: 0 0 6px; }
.md :deep(.md-p:last-child) { margin-bottom: 0; }
.md :deep(.md-h) { margin: 8px 0 4px; font-size: 13px; font-weight: 600; }
/* 列表：**必须自己把符号加回来**。
   Tailwind（app.css 里 @import "tailwindcss"）的 preflight 会全局 `ol,ul{list-style:none}`，
   那个重置也在同一页面上生效 —— 不显式写 list-style，列表就只剩缩进、没有圆点
   （用户看到的就是"缺少列表基础样式"）。同理 padding 也在 preflight 里被清零。 */
.md :deep(.md-list) { margin: 4px 0 6px; padding-left: 20px; list-style: disc outside; }
.md :deep(.md-list li) { margin: 2px 0; list-style: inherit; }
.md :deep(.md-list li::marker) { color: var(--ui-ink-dim, #919191); }
.md :deep(code) { padding: 1px 5px; border-radius: 5px; background: var(--ui-veil, rgb(0 0 0 / 0.05)); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
.md :deep(.md-code) { margin: 6px 0; padding: 8px 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel-soft, #fff); overflow-x: auto; }
.md :deep(.md-code code) { padding: 0; background: transparent; font-size: 11px; white-space: pre; }
.md :deep(a) { color: var(--ui-accent, #0891b2); text-decoration: underline; }
</style>
