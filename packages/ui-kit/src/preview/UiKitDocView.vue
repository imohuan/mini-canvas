<script setup lang="ts">
/**
 * 组件文档区：读取 Markdown，普通段落安全渲染，vue 代码块以真实组件预览。
 *
 * 文档文件在 packages/ui-kit/docs/<组件>.md，内容按 Vite 构建期编译，
 * 浏览器里只拿到已编译好的组件；页面切换组件时用 :key 重新取对应文档。
 */
import { computed, ref } from 'vue'
import { Check, Code2, Copy, Eye } from 'lucide-vue-next'
import type { Component } from 'vue'
import { codeLangLabel, parseMarkdown } from './markdown'

const props = defineProps<{
  /** Markdown 源文本 */
  source: string
  /** 由 Vite 从 Markdown 的 vue 代码块编译出的组件列表 */
  examples: Component[]
  /** 与文档中代码块一一对应的、构建期生成的高亮 HTML */
  codeHtml: string[]
}>()

const blocks = computed(() => parseMarkdown(props.source))
const openTabs = ref<Record<number, 'preview' | 'code'>>({})
const copied = ref<number | null>(null)
/** 文档里每个代码块的高亮 HTML 按出现顺序排好，预览组件只给 vue 块使用。 */
const highlighted = computed(() => props.codeHtml)

/** 每个示例单独记住自己的标签；默认看运行结果。 */
function tabOf(index: number): 'preview' | 'code' {
  return openTabs.value[index] ?? 'preview'
}

function setTab(index: number, tab: 'preview' | 'code'): void {
  openTabs.value = { ...openTabs.value, [index]: tab }
}

async function copyCode(index: number, source: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(source)
    copied.value = index
    window.setTimeout(() => {
      if (copied.value === index) copied.value = null
    }, 1600)
  } catch {
    copied.value = null
  }
}
</script>

<template>
  <div class="mck-doc">
    <template v-for="(block, index) in blocks" :key="block.type + index">
      <div v-if="block.type === 'html'" class="mck-doc-html" v-html="block.html"></div>
      <div v-else-if="block.exampleIndex >= 0" class="mck-doc-example">
        <div class="mck-doc-example-head">
        <span class="mck-doc-example-label">示例 {{ block.exampleIndex + 1 }}</span>
          <div class="mck-doc-example-tabs">
            <button type="button" :class="{ 'is-active': tabOf(index) === 'preview' }" @click="setTab(index, 'preview')">
              <Eye :size="13" /> 预览
            </button>
            <button type="button" :class="{ 'is-active': tabOf(index) === 'code' }" @click="setTab(index, 'code')">
              <Code2 :size="13" /> 代码
            </button>
          </div>
        </div>
        <div v-if="tabOf(index) === 'preview'" class="mck-doc-example-preview">
          <component :is="examples[block.exampleIndex]" />
        </div>
        <div v-else class="mck-doc-code-block is-example">
          <div class="mck-doc-code-tools">
            <span class="mck-doc-code-lang">{{ codeLangLabel(block.lang) }}</span>
            <button
              type="button"
              class="mck-doc-code-copy"
              :aria-label="copied === index ? '已复制' : '复制代码'"
              :title="copied === index ? '已复制' : '复制代码'"
              @click="copyCode(index, block.source)"
            >
              <Check v-if="copied === index" :size="13" />
              <Copy v-else :size="13" />
              <span>{{ copied === index ? '已复制' : '复制' }}</span>
            </button>
          </div>
          <div class="mck-doc-code" v-html="highlighted[block.codeIndex]"></div>
        </div>
      </div>
      <div v-else class="mck-doc-code-block">
        <div class="mck-doc-code-tools">
          <span class="mck-doc-code-lang">{{ codeLangLabel(block.lang) }}</span>
          <button
            type="button"
            class="mck-doc-code-copy"
            :aria-label="copied === index ? '已复制' : '复制代码'"
            :title="copied === index ? '已复制' : '复制代码'"
            @click="copyCode(index, block.source)"
          >
            <Check v-if="copied === index" :size="13" />
            <Copy v-else :size="13" />
            <span>{{ copied === index ? '已复制' : '复制' }}</span>
          </button>
        </div>
        <div class="mck-doc-code" v-html="highlighted[block.codeIndex]"></div>
      </div>
    </template>
    <p v-if="blocks.length === 0" class="mck-doc-empty">这篇组件文档还是空的。</p>
  </div>
</template>

<style scoped>
.mck-doc {
  color: var(--mck-ink-muted, #6b7280);
  font-size: 13px;
  line-height: 1.8;
}

.mck-doc-html :deep(h1) {
  margin: 0 0 10px;
  color: var(--mck-ink, #18202b);
  font-size: 18px;
  line-height: 1.4;
}

.mck-doc-html :deep(h2) {
  margin: 20px 0 8px;
  color: var(--mck-ink, #18202b);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.mck-doc-html :deep(h3) {
  margin: 16px 0 6px;
  color: var(--mck-ink, #18202b);
  font-size: 13px;
  font-weight: 700;
}

.mck-doc-html :deep(p) {
  margin: 0 0 10px;
}

.mck-doc-html :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--mck-chip, rgb(0 0 0 / 0.05));
  color: var(--mck-ink, #18202b);
  font-family: var(--mck-font-mono);
  font-size: 11px;
}

.mck-doc-html :deep(ul),
.mck-doc-html :deep(ol) {
  margin: 6px 0 10px;
  padding-left: 20px;
}

.mck-doc-html :deep(li) {
  margin: 3px 0;
}

.mck-doc-html :deep(strong) {
  color: var(--mck-ink, #18202b);
  font-weight: 700;
}

.mck-doc-html :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 2px solid var(--mck-accent, #0891b2);
  border-radius: 0 8px 8px 0;
  background: var(--mck-hover, rgb(0 0 0 / 0.035));
}

.mck-doc-html :deep(a) {
  color: var(--mck-accent, #0891b2);
  text-decoration: underline;
}

.mck-doc-html :deep(table) {
  width: 100%;
  margin: 10px 0 14px;
  overflow: hidden;
  border: 1px solid var(--mck-line, #eef0f4);
  border-collapse: separate;
  border-radius: 10px;
  border-spacing: 0;
  font-size: 12px;
}

.mck-doc-html :deep(th),
.mck-doc-html :deep(td) {
  padding: 8px 10px;
  border-bottom: 1px solid var(--mck-line, #eef0f4);
  text-align: left;
  vertical-align: top;
}

.mck-doc-html :deep(th) {
  background: var(--mck-hover, rgb(0 0 0 / 0.035));
  color: var(--mck-ink, #18202b);
  font-size: 11px;
  font-weight: 700;
}

.mck-doc-html :deep(tbody tr:last-child td) {
  border-bottom: 0;
}

.mck-doc-example {
  margin: 12px 0 16px;
  overflow: hidden;
  border: 1px solid var(--mck-line, #e2e5ea);
  border-radius: 12px;
  background: var(--mck-panel, #fff);
}

.mck-doc-example-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--mck-line, #eef0f4);
  background: var(--mck-hover, rgb(0 0 0 / 0.035));
}

.mck-doc-example-label {
  color: var(--mck-ink-muted, #8c95a3);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.mck-doc-example-tabs {
  display: flex;
  gap: 2px;
}

.mck-doc-example-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mck-ink-muted, #8c95a3);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.mck-doc-example-tabs button.is-active {
  background: var(--mck-panel, #fff);
  color: var(--mck-ink, #18202b);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
}

.mck-doc-example-preview {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background:
    radial-gradient(circle, var(--mck-line, rgb(0 0 0 / 0.08)) 1px, transparent 1px) 0 0 / 16px 16px,
    var(--mck-panel, #fff);
}

.mck-doc-code-block {
  position: relative;
  margin: 10px 0 12px;
  overflow: hidden;
  border: 1px solid var(--mck-line, #e2e5ea);
  border-radius: 12px;
  background: var(--mck-panel-soft, rgb(0 0 0 / 0.035));
}

.mck-doc-code-block.is-example {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: var(--mck-panel-soft, rgb(0 0 0 / 0.035));
}

.mck-doc-code-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}

.mck-doc-code-block:hover .mck-doc-code-tools,
.mck-doc-code-block:focus-within .mck-doc-code-tools {
  opacity: 1;
  pointer-events: auto;
}

.mck-doc-code-lang {
  padding: 2px 7px;
  border: 1px solid var(--mck-line, #e2e5ea);
  border-radius: 6px;
  background: var(--mck-panel, #fff);
  color: var(--mck-ink-muted, #8c95a3);
  font-family: var(--mck-font-mono);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
}

.mck-doc-code-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--mck-line, #e2e5ea);
  border-radius: 6px;
  background: var(--mck-panel, #fff);
  color: var(--mck-ink-muted, #6b7280);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.mck-doc-code-copy:hover {
  background: var(--mck-hover, rgb(0 0 0 / 0.04));
  color: var(--mck-ink, #18202b);
}

.mck-doc-code {
  overflow-x: auto;
}

.mck-doc-code :deep(pre.shiki) {
  background: transparent !important;
}


.mck-doc-code :deep(pre) {
  margin: 0;
  padding: 12px 14px;
  font-family: var(--mck-font-mono);
  font-size: 11px;
  line-height: 1.7;
  tab-size: 2;
}

.mck-doc-code :deep(code) {
  padding: 0;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .mck-doc-code-tools {
    transition: none;
  }
}

.mck-doc-empty {
  margin: 0;
  color: var(--mck-ink-muted, #8c95a3);
  font-size: 12px;
}
</style>


