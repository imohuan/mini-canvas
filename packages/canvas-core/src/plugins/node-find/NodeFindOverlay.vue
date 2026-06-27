<template>
  <Teleport to="body">
    <div class="node-find-overlay" @click.self="$emit('close')">
      <div class="node-find-panel" @click.stop>
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
            @click="focusNode(node.id)"
            @mouseenter="selectedIndex = index"
          >
            <span class="node-find-label">{{ node.data?.label || node.id }}</span>
            <span class="node-find-type">{{ node.data?.nodeType || 'custom' }}</span>
          </div>
          <div v-if="filtered.length === 0 && query" class="node-find-empty">
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

const filtered = computed(() => {
  if (!query.value) return props.nodes.slice(0, 20)
  const q = query.value.toLowerCase()
  return props.nodes.filter(n => {
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
.node-find-overlay {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgb(0 0 0 / 0.35);
}

.node-find-panel {
  width: 420px;
  max-height: 60vh;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 18px;
  background: rgb(24 24 27 / 0.96);
  box-shadow: 0 22px 70px rgb(0 0 0 / 0.45);
  backdrop-filter: blur(18px);
  overflow: hidden;
}

.node-find-input {
  width: 100%;
  padding: 16px 20px;
  border: 0;
  background: transparent;
  color: #f4f4f5;
  font-size: 16px;
  outline: none;
}

.node-find-input::placeholder {
  color: #71717a;
}

.node-find-results {
  max-height: calc(60vh - 60px);
  overflow-y: auto;
  padding: 4px 10px 10px;
}

.node-find-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
}

.node-find-item.is-selected {
  background: rgb(255 255 255 / 0.1);
}

.node-find-label {
  font-size: 14px;
  font-weight: 600;
  color: #f4f4f5;
}

.node-find-type {
  font-size: 11px;
  color: #a1a1aa;
  background: rgb(255 255 255 / 0.08);
  padding: 2px 8px;
  border-radius: 5px;
}

.node-find-empty {
  padding: 24px;
  text-align: center;
  color: #71717a;
  font-size: 14px;
}
</style>