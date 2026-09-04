<template>
  <Teleport to="body">
    <div class="node-find-overlay" @pointerdown.self="$emit('close')">
      <div class="node-find-panel" @pointerdown.stop>
        <input
          ref="inputEl"
          v-model="query"
          class="node-find-input"
          placeholder="搜索节点（名称/类型）..."
          @keydown.down.prevent="moveSelection(1)"
          @keydown.up.prevent="moveSelection(-1)"
          @keydown.enter.prevent="confirmSelection"
          @keydown.escape="$emit('close')"
        />
        <div class="node-find-results">
          <div
            v-for="(node, index) in filtered"
            :key="node.id"
            class="node-find-item"
            :class="{ 'is-selected': index === selectedIndex }"
            :style="typeStyle(node.data?.nodeType)"
            @click="focusNode(node.id)"
            @mouseenter="selectedIndex = index"
          >
            <span class="node-find-label">{{ node.data?.label || node.id }}</span>
            <span class="node-find-type">{{ typeMeta(node.data?.nodeType).label }}</span>
          </div>
          <div v-if="filtered.length === 0 && query" class="no-results">
            无匹配节点
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import type { Node } from '@vue-flow/core'

const props = defineProps<{
  nodes: Node[]
}>()

const emit = defineEmits<{
  focus: [nodeId: string]
  close: []
}>()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement>()

// 节点类型 → {中文名, 浅色背景, 深色文字}，按视觉区分多种节点
const TYPE_PRESETS: Record<string, { label: string; bg: string; fg: string }> = {
  image: { label: '图片', bg: '#ede9fe', fg: '#6d28d9' },        // violet
  panorama: { label: '全景', bg: '#cffafe', fg: '#0e7490' },    // cyan
  video: { label: '视频', bg: '#fce7f3', fg: '#be185d' },       // pink
  'image-compare': { label: '对比图', bg: '#fef3c7', fg: '#b45309' }, // amber
  group: { label: '分组', bg: '#dbeafe', fg: '#1d4ed8' },       // blue
  text: { label: '文本', bg: '#dcfce7', fg: '#15803d' },        // green
  temp: { label: '临时', bg: '#e5e7eb', fg: '#4b5563' },        // gray
}
const TYPE_FALLBACK = { label: '自定义', bg: '#f3f4f6', fg: '#6b7280' }

function typeMeta(raw: string | undefined) {
  const key = String(raw || '').trim()
  return TYPE_PRESETS[key] ?? TYPE_FALLBACK
}

function typeStyle(raw: string | undefined) {
  const m = typeMeta(raw)
  return {
    '--type-bg': m.bg,
    '--type-fg': m.fg,
  } as Record<string, string>
}

const filtered = computed(() => {
  // 过滤掉名称以 temp-target- 开头的临时目标节点
  const hidden = props.nodes.filter(n => !String(n.data?.label || n.id).startsWith('temp-target-'))
  if (!query.value) return hidden.slice(0, 20)
  const q = query.value.toLowerCase()
  return hidden.filter(n => {
    const label = String(n.data?.label || '').toLowerCase()
    const nodeType = String(n.data?.nodeType || '').toLowerCase()
    return label.includes(q) || n.id.toLowerCase().includes(q) || nodeType.includes(q)
  }).slice(0, 20)
})

function moveSelection(delta: number) {
  const max = filtered.value.length - 1
  selectedIndex.value = Math.max(0, Math.min(max, selectedIndex.value + delta))
}

function confirmSelection() {
  const node = filtered.value[selectedIndex.value]
  if (node) focusNode(node.id)
}

function focusNode(nodeId: string) {
  emit('focus', nodeId)
  emit('close')
}

onMounted(async () => {
  await nextTick()
  inputEl.value?.focus()
})
</script>

<style scoped>
/* ============ 外层浮层 ============ */
.node-find-overlay {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.2));
}

/* ============ 面板 ============ */
.node-find-panel {
  width: min(440px, calc(100vw - 64px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

/* ============ 输入框 ============ */
.node-find-input {
  width: 100%;
  padding: 16px 20px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #111827;
  font-size: 16px;
  font-weight: 500;
}
.node-find-input::placeholder {
  color: #9ca3af;
}

/* ============ 列表 ============ */
.node-find-results {
  max-height: calc(70vh - 62px);
  overflow-y: auto;
  padding: 4px 10px 10px;
}
.node-find-results::-webkit-scrollbar {
  width: 8px;
}
.node-find-results::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.node-find-results::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.node-find-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.18s ease;
}
.node-find-item:hover {
  background: rgba(0, 0, 0, 0.05);
}
.node-find-item.is-selected {
  background: rgba(0, 0, 0, 0.08);
}
.node-find-item.is-selected:hover {
  background: rgba(0, 0, 0, 0.1);
}

.node-find-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.node-find-type {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--type-fg, #6b7280);
  background: var(--type-bg, rgba(0, 0, 0, 0.06));
  padding: 2px 8px;
  border-radius: 6px;
}

.no-results {
  padding: 24px;
  text-align: center;
  color: #9ca3af;
  font-size: 14px;
}
</style>