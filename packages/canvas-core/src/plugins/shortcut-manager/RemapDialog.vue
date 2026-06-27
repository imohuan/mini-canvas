<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ShortcutManager, type ShortcutHelpItem } from '../ShortcutManager'

const props = defineProps<{ item: ShortcutHelpItem }>()
const emit = defineEmits<{ close: [] }>()

const manager = ShortcutManager.getInstance()
const newKeys = ref('')
const listening = ref(false)
const conflict = ref<string | null>(null)
const success = ref(false)

/** 修饰键集合 — 也可能独立成为快捷键（如单用 Shift） */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** 修饰键名 → 快捷键字符串里的简称 */
const MODIFIER_ALIAS: Record<string, string> = {
  Control: 'ctrl',
  Shift: 'shift',
  Alt: 'alt',
  Meta: 'meta',
}

/** 当前按住未松开的修饰键 */
const heldModifiers = new Set<string>()

/** 本次监听期间按过的所有修饰键（用于纯修饰键捕获） */
const allModifiersPressed = new Set<string>()

/** 是否已按下过非修饰键 */
let hasNonModifier = false

function startListening() {
  if (listening.value) return
  listening.value = true
  newKeys.value = '请按下快捷键...'
  conflict.value = null
  success.value = false
  heldModifiers.clear()
  allModifiersPressed.clear()
  hasNonModifier = false
}

/** 修饰键 + 普通键 → 快捷键字符串 */
function formatShortcut(key: string, modifiers: Set<string>): string {
  const parts: string[] = []
  const order = ['Control', 'Shift', 'Alt', 'Meta']
  for (const m of order) {
    if (modifiers.has(m)) parts.push(MODIFIER_ALIAS[m])
  }
  parts.push(key.toLowerCase())
  return parts.join('+')
}

/** 纯修饰键 → 快捷键字符串（如 ctrl+shift） */
function formatModifiersOnly(modifiers: Set<string>): string {
  const parts: string[] = []
  const order = ['Control', 'Shift', 'Alt', 'Meta']
  for (const m of order) {
    if (modifiers.has(m)) parts.push(MODIFIER_ALIAS[m])
  }
  return parts.join('+')
}

/** 捕获完成后的统一处理 */
function captureShortcut(keys: string) {
  newKeys.value = keys
  listening.value = false
  heldModifiers.clear()
  allModifiersPressed.clear()

  const result = manager.remap(props.item.id, keys)
  if (result.ok) {
    success.value = true
    conflict.value = null
  } else if ('conflict' in result && result.conflict) {
    conflict.value = `与 "${result.conflict.entries[0]?.command || '其他快捷键'}" 冲突`
    success.value = false
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (!listening.value) return

  const keyName = e.key

  // 修饰键：记录但不立即捕获
  if (MODIFIER_KEYS.has(keyName)) {
    heldModifiers.add(keyName)
    allModifiersPressed.add(keyName)
    e.preventDefault()
    return
  }

  // 非修饰键 → 立即捕获为组合键
  hasNonModifier = true
  e.preventDefault()
  e.stopPropagation()

  captureShortcut(formatShortcut(keyName, heldModifiers))
}

function handleKeyUp(e: KeyboardEvent) {
  if (!listening.value) return

  if (MODIFIER_KEYS.has(e.key)) {
    heldModifiers.delete(e.key)

    // 所有修饰键都松开了，且没按过任何普通键 → 捕获为纯修饰键快捷键
    if (heldModifiers.size === 0 && !hasNonModifier) {
      captureShortcut(formatModifiersOnly(allModifiersPressed))
    }
  }
}

function confirmClose() {
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown, true)
  document.addEventListener('keyup', handleKeyUp, true)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown, true)
  document.removeEventListener('keyup', handleKeyUp, true)
})
</script>

<template>
  <div class="remap-backdrop" @click="emit('close')">
    <div class="remap-dialog" @click.stop>
      <h3>重映射快捷键</h3>
      <p class="remap-command">{{ item.command }}</p>

      <div class="remap-current">
        <span class="label">当前键位：</span>
        <span class="keys">{{ item.keys }}</span>
      </div>

      <div class="remap-input-area">
        <button
          class="remap-listen-btn"
          @click="startListening"
          :class="{ listening: listening }"
        >
          {{ listening ? '请按键...' : (newKeys || '点击设置新快捷键') }}
        </button>
      </div>

      <div v-if="conflict" class="remap-conflict">
        ⚠ {{ conflict }}
      </div>
      <div v-if="success" class="remap-success">
        ✅ 快捷键已更新为 "{{ newKeys }}"
      </div>

      <div class="remap-actions">
        <button @click="confirmClose">{{ success ? '完成' : '取消' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.remap-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
}

.remap-dialog {
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 24px;
  width: 360px;
  color: #e0e0e0;
  font-family: system-ui, -apple-system, sans-serif;
}

.remap-dialog h3 { margin: 0 0 8px 0; font-size: 16px; }
.remap-command { color: #888; font-size: 14px; margin-bottom: 16px; }

.remap-current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 14px;
}

.remap-current .label { color: #888; }
.remap-current .keys {
  font-family: monospace;
  background: #16213e;
  border: 1px solid #3b82f6;
  color: #3b82f6;
  padding: 2px 8px;
  border-radius: 4px;
}

.remap-input-area { margin-bottom: 12px; }

.remap-listen-btn {
  width: 100%;
  padding: 10px;
  border: 2px dashed #555;
  border-radius: 8px;
  background: #16213e;
  color: #888;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.remap-listen-btn:hover { border-color: #3b82f6; }
.remap-listen-btn.listening {
  border-color: #3b82f6;
  color: #3b82f6;
  border-style: solid;
}

.remap-conflict { color: #f59e0b; font-size: 13px; margin-bottom: 12px; }
.remap-success { color: #10b981; font-size: 13px; margin-bottom: 12px; }

.remap-actions { display: flex; justify-content: flex-end; gap: 8px; }
.remap-actions button {
  background: #16213e;
  border: 1px solid #444;
  color: #ccc;
  padding: 8px 20px;
  border-radius: 6px;
  cursor: pointer;
}
.remap-actions button:hover { background: #233; color: #fff; }
</style>
