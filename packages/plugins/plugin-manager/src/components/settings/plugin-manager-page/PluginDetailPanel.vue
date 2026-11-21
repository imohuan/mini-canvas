<script setup lang="ts">
/**
 * PluginDetailPanel —— 插件详情二级面板：渲染 npm 包的 README（markdown）。
 * 交互对齐「平台」页：顶部 ← 返回插件列表。
 * markdown 用 marked 渲染、DOMPurify 过滤 XSS（README 来自 npm，内容不可信）。
 */
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Loader2 } from 'lucide-vue-next'
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { PluginManagerService } from '../../../pluginManagerService'

const props = defineProps<{ s: PluginManagerService['state'] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const Button = useUiComponent('Button')

const html = computed(() => {
  if (!props.s.detailReadme) return ''
  // marked 同步渲染；unsafe 的原始 html 由 DOMPurify 统一过滤
  return DOMPurify.sanitize(marked.parse(props.s.detailReadme, { async: false }) as string)
})
</script>

<template>
  <div class="pmp-detail">
    <Button variant="ghost" size="xs" type="button" class="pmp-detail-back" @click="emit('close')">
      ← 返回插件列表
    </Button>
    <div v-if="s.detailLoading" class="pmp-detail-loading">
      <Loader2 class="spin" :size="16" aria-hidden="true" />
      正在加载 README…
    </div>
    <div v-else-if="s.detailError" class="pmp-detail-error" role="alert">
      {{ s.detailError }}
    </div>
    <div v-else-if="!s.detailReadme" class="pmp-detail-empty">这个包没有 README。</div>
    <article v-else class="pmp-detail-readme" v-html="html" />
  </div>
</template>

<style scoped>
.pmp-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 240px;
}
.pmp-detail-back {
  align-self: flex-start;
}
.pmp-detail-loading,
.pmp-detail-error,
.pmp-detail-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--ink-mute, #888);
  font-size: 12px;
}
.pmp-detail-error {
  color: var(--tone-err, #c44);
}
.pmp-detail-readme {
  font-size: 12.5px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.pmp-detail-readme :deep(h1),
.pmp-detail-readme :deep(h2),
.pmp-detail-readme :deep(h3) {
  font-size: 14px;
  margin: 14px 0 8px;
}
.pmp-detail-readme :deep(p) {
  margin: 8px 0;
}
.pmp-detail-readme :deep(ul),
.pmp-detail-readme :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}
/* Tailwind reset 清掉了 list-style，这里必须补回（用户 2026-11-21 实测列表没有符号） */
.pmp-detail-readme :deep(ul) {
  list-style: disc outside;
}
.pmp-detail-readme :deep(ol) {
  list-style: decimal outside;
}
.pmp-detail-readme :deep(li) {
  margin: 3px 0;
}
.pmp-detail-readme :deep(li > ul),
.pmp-detail-readme :deep(li > ol) {
  margin: 3px 0 3px 4px;
}
.pmp-detail-readme :deep(ul ul) {
  list-style: circle outside;
}
.pmp-detail-readme :deep(hr) {
  border: none;
  border-top: 1px solid var(--line, rgba(127, 127, 127, 0.3));
  margin: 14px 0;
}
.pmp-detail-readme :deep(a) {
  color: var(--brand, #4a90d9);
  text-decoration: underline;
  overflow-wrap: anywhere;
}
.pmp-detail-readme :deep(strong) {
  font-weight: 700;
}
.pmp-detail-readme :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 12px;
}
.pmp-detail-readme :deep(th),
.pmp-detail-readme :deep(td) {
  border: 1px solid var(--line, rgba(127, 127, 127, 0.3));
  padding: 4px 8px;
  text-align: left;
}
.pmp-detail-readme :deep(th) {
  background: var(--thumb-soft, rgba(127, 127, 127, 0.1));
}
.pmp-detail-readme :deep(code) {
  background: var(--thumb-soft, rgba(127, 127, 127, 0.15));
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11.5px;
}
.pmp-detail-readme :deep(pre) {
  background: var(--thumb-soft, rgba(127, 127, 127, 0.12));
  padding: 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
}
.pmp-detail-readme :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
.pmp-detail-readme :deep(blockquote) {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 3px solid var(--line, rgba(127, 127, 127, 0.3));
  color: var(--ink-mute, #888);
}
</style>
