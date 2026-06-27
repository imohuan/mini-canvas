<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ShortcutManager, type ShortcutHelpItem, type ShortcutGroup } from '../ShortcutManager'
import RemapDialog from './RemapDialog.vue'

defineProps<{ onClose: () => void }>()
const emit = defineEmits<{ close: [] }>()

const manager = ShortcutManager.getInstance()
const searchQuery = ref('')
const conflicts = ref(manager.getConflicts())
const helpList = ref(manager.getHelpList())
const showRemapDialog = ref(false)
const remappingItem = ref<ShortcutHelpItem | null>(null)

const groupLabels: Record<ShortcutGroup, string> = {
  system: '系统',
  edit: '编辑',
  canvas: '画布',
  view: '视图',
  plugin: '插件',
}

const filteredHelpList = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return helpList.value
  return helpList.value.map(g => ({
    ...g,
    items: g.items.filter(i =>
      i.command.toLowerCase().includes(q) ||
      i.keys.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q)
    ),
  })).filter(g => g.items.length > 0)
})

function openRemap(item: ShortcutHelpItem) {
  remappingItem.value = item
  showRemapDialog.value = true
}

function onRemapDone() {
  // Refresh the list after remap
  helpList.value = manager.getHelpList()
  conflicts.value = manager.getConflicts()
  showRemapDialog.value = false
  remappingItem.value = null
}

function resetDefaults() {
  manager.resetDefaults()
  helpList.value = manager.getHelpList()
  conflicts.value = manager.getConflicts()
}

function exportKeymap() {
  const data = manager.exportKeymap()
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shortcut-keymap.json'
  a.click()
  URL.revokeObjectURL(url)
}

function importKeymap() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        manager.loadKeymap(data)
        helpList.value = manager.getHelpList()
        conflicts.value = manager.getConflicts()
      } catch {
        alert('导入失败：JSON 格式无效')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

// Handle Escape to close
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="#app">
    <div class="shortcut-help-backdrop" @click="emit('close')">
      <div class="shortcut-help-panel" @click.stop>
        <div class="shortcut-help-header">
          <h2>快捷键参考</h2>
          <button class="close-btn" @click="emit('close')">&times;</button>
        </div>

        <div class="shortcut-help-search">
          <input
            v-model="searchQuery"
            placeholder="搜索快捷键..."
            class="search-input"
            autofocus
          />
        </div>

        <div class="shortcut-help-list">
          <div v-for="group in filteredHelpList" :key="group.group" class="shortcut-group">
            <h3 class="group-title">{{ groupLabels[group.group] || group.group }}</h3>
            <div v-for="item in group.items" :key="item.id" class="shortcut-row">
              <span class="shortcut-keys">{{ item.keys }}</span>
              <span class="shortcut-command">{{ item.command }}</span>
              <button class="remap-btn" @click="openRemap(item)">重映射</button>
            </div>
          </div>
          <div v-if="filteredHelpList.length === 0" class="no-results">
            无匹配结果
          </div>
        </div>

        <div class="shortcut-help-footer">
          <span v-if="conflicts.length > 0" class="conflict-warning">
            ⚠ {{ conflicts.length }} 个冲突
          </span>
          <button @click="resetDefaults">恢复默认</button>
          <button @click="exportKeymap">导出</button>
          <button @click="importKeymap">导入</button>
        </div>
      </div>
    </div>

    <RemapDialog
      v-if="showRemapDialog && remappingItem"
      :item="remappingItem"
      @close="onRemapDone"
    />
  </Teleport>
</template>

<style scoped>
.shortcut-help-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.shortcut-help-panel {
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 24px;
  width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  color: #e0e0e0;
  font-family: system-ui, -apple-system, sans-serif;
}

.shortcut-help-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.shortcut-help-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.close-btn:hover { color: #fff; }

.shortcut-help-search {
  margin-bottom: 16px;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #444;
  background: #16213e;
  color: #e0e0e0;
  font-size: 14px;
  box-sizing: border-box;
}
.search-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.shortcut-help-list {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 16px;
}

.shortcut-group {
  margin-bottom: 12px;
}

.group-title {
  font-size: 12px;
  text-transform: uppercase;
  color: #888;
  margin: 0 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid #333;
}

.shortcut-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  gap: 12px;
  transition: background 0.15s;
}
.shortcut-row:hover { background: rgba(255,255,255,0.05); }

.shortcut-keys {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  background: #16213e;
  border: 1px solid #3b82f6;
  color: #3b82f6;
  padding: 2px 8px;
  border-radius: 4px;
  min-width: 100px;
  text-align: center;
}

.shortcut-command {
  flex: 1;
  font-size: 14px;
}

.remap-btn {
  background: transparent;
  border: 1px solid #555;
  color: #aaa;
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.remap-btn:hover {
  background: #333;
  color: #fff;
}

.no-results {
  text-align: center;
  color: #666;
  padding: 24px 0;
}

.shortcut-help-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #333;
}

.conflict-warning {
  flex: 1;
  color: #f59e0b;
  font-size: 13px;
}

.shortcut-help-footer button {
  background: #16213e;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.shortcut-help-footer button:hover {
  background: #233;
  color: #fff;
}
</style>
