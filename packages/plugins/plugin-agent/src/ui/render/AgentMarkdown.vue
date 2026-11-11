<script setup lang="ts">
// 轻量 Markdown 渲染：内容先转义再拼标签（见 markdown.ts 的 XSS 说明）。
import { computed } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { splitMarkdown } from './markdown.js'

const props = defineProps<{ text: string }>()

/**
 * 分段渲染：代码块照 shadcn 官方 MarkdownCode 示例的写法 ——
 * CodeBlock + Header(Title/Actions/CopyButton) + Content(Line/Token 用 useHighlightedCode)，
 * 不加 size / wrap / max-height 之类自己的参数。
 */
const segments = computed(() => splitMarkdown(props.text))

const CodeBlock = useUiComponent('CodeBlock')
const CodeBlockHeader = useUiComponent('CodeBlockHeader')
const CodeBlockTitle = useUiComponent('CodeBlockTitle')
const CodeBlockActions = useUiComponent('CodeBlockActions')
const CodeBlockCopyButton = useUiComponent('CodeBlockCopyButton')
// 与官方 Highlighted.vue 同一写法（CodeBlockContent + Line + Token + useHighlightedCode）
const CodeBlockHighlighted = useUiComponent('CodeBlockHighlighted')
</script>

<template>
  <div class="md">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.type === 'html'" v-html="seg.html"></div>
      <!-- class="my-3" 与官方 MarkdownCode 示例一致（不是自定义样式） -->
      <CodeBlock v-else class="my-3">
        <CodeBlockHeader>
          <CodeBlockTitle>{{ seg.lang || 'text' }}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton :value="seg.code" />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockHighlighted :code="seg.code" :language="seg.lang || 'text'" />
      </CodeBlock>
    </template>
  </div>
</template>

<style scoped>
.md { font-size: 14px; line-height: 1.65; color: var(--ui-ink); word-break: break-word; }
.md :deep(.md-p) { margin: 0 0 6px; }
.md :deep(.md-p:last-child) { margin-bottom: 0; }
.md :deep(.md-h) { margin: 8px 0 4px; font-size: 15px; font-weight: 600; }
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
