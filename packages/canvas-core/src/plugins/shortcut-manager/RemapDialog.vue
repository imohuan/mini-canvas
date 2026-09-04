<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
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
  newKeys.value = ''
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

function resetToCurrent() {
  // 清回未修改
  newKeys.value = props.item.keys
  conflict.value = null
  success.value = false
}

function collapse() {
  emit('close')
}

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown, true)
  document.removeEventListener('keyup', handleKeyUp, true)
})

// 监听生命周期由父组件控制：组件挂载即开始监听（如果是打开状态）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', handleKeyDown, true)
  document.addEventListener('keyup', handleKeyUp, true)
}

/** 渲染 newKeys 为 kbd chips（共用父级风格） */
function renderKeyParts(keys: string) {
  return keys.split('+').map(p => p.trim()).filter(Boolean)
}
</script>

<template>
  <div class="remap-inline" @pointerdown.stop>
    <div class="remap-inline-head">
      <span class="remap-inline-eyebrow">重映射</span>
      <span class="remap-inline-title">{{ item.command }}</span>
      <button class="remap-collapse-btn" title="收起" @click="collapse">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
    </div>

    <div class="remap-inline-body">
      <div class="remap-inline-row">
        <span class="remap-inline-label">当前</span>
        <span class="shortcut-keys">
          <template v-for="(part, pIdx) in renderKeyParts(item.keys)" :key="`cur-${pIdx}`">
            <span class="kbd-chip">{{ part }}</span>
            <span v-if="pIdx < renderKeyParts(item.keys).length - 1" class="kbd-plus">+</span>
          </template>
        </span>
      </div>

      <div class="remap-inline-row">
        <span class="remap-inline-label">新键位</span>
        <button
          class="remap-listen-btn"
          :class="{ listening: listening, 'has-value': !!newKeys && !listening }"
          @click="startListening"
          type="button"
        >
          <template v-if="listening">
            <span class="listening-dot" />等待按键…
          </template>
          <template v-else-if="newKeys">
            <template v-for="(part, pIdx) in renderKeyParts(newKeys)" :key="`new-${pIdx}`">
              <span class="kbd-chip">{{ part }}</span>
              <span v-if="pIdx < renderKeyParts(newKeys).length - 1" class="kbd-plus">+</span>
            </template>
          </template>
          <template v-else>
            点击录制新快捷键
          </template>
        </button>
      </div>

      <div v-if="conflict" class="remap-conflict">⚠ {{ conflict }}</div>
      <div v-else-if="success" class="remap-success">✓ 已更新</div>

      <div class="remap-inline-actions">
        <button class="remap-text-btn" @click="resetToCurrent" :disabled="listening">还原当前</button>
        <button class="remap-text-btn" @click="startListening" :disabled="listening">重新录制</button>
        <button class="remap-primary-btn" @click="collapse">{{ success ? '完成' : '收起' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.remap-inline {
  margin: 4px 4px 6px 44px;
  padding: 10px 12px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.035);
  border: 1px solid rgba(0, 0, 0, 0.06);
  animation: remap-inline-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.remap-inline-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
  margin-bottom: 10px;
}

.remap-inline-eyebrow {
  font-size: 10px;
  font-weight: 700;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}

.remap-inline-title {
  font-size: 13px;
  font-weight: 700;
  color: #111827;
  flex: 1;
}

.remap-collapse-btn {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  color: #6b7280;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.remap-collapse-btn :deep(svg) {
  width: 14px;
  height: 14px;
}
.remap-collapse-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}

.remap-inline-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.remap-inline-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.remap-inline-label {
  flex: 0 0 48px;
  font-size: 11px;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.remap-listen-btn {
  flex: 1;
  min-height: 36px;
  padding: 6px 12px;
  border: 1px dashed rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  background: #ffffff;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.remap-listen-btn:hover {
  border-color: rgba(0, 0, 0, 0.32);
  color: #111827;
}

.remap-listen-btn.listening {
  border-style: solid;
  border-color: #0891b2;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.08);
  animation: remap-pulse 1.2s ease-in-out infinite;
}

.remap-listen-btn.has-value {
  border-style: solid;
  border-color: rgba(0, 0, 0, 0.08);
  color: #111827;
}

.listening-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0891b2;
  margin-right: 6px;
  box-shadow: 0 0 0 0 rgba(8, 145, 178, 0.6);
}

.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.kbd-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: #ffffff;
  color: #374151;
  font-family: 'SF Mono', ui-monospace, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.kbd-plus {
  color: #9ca3af;
  font-size: 10px;
  font-weight: 700;
}

.remap-conflict {
  font-size: 11px;
  font-weight: 700;
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
  padding: 4px 8px;
  border-radius: 6px;
  margin-top: 2px;
}

.remap-success {
  font-size: 11px;
  font-weight: 700;
  color: #047857;
  background: rgba(16, 185, 129, 0.14);
  padding: 4px 8px;
  border-radius: 6px;
  margin-top: 2px;
}

.remap-inline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 4px;
}

.remap-text-btn {
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s ease, color 0.15s ease;
}
.remap-text-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}
.remap-text-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.remap-primary-btn {
  padding: 6px 14px;
  border: 0;
  background: #0891b2;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.remap-primary-btn:hover {
  background: #0e7490;
}
.remap-primary-btn:active {
  transform: scale(0.97);
}

@keyframes remap-inline-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes remap-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(8, 145, 178, 0.4); }
  50%      { box-shadow: 0 0 0 6px rgba(8, 145, 178, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .remap-inline,
  .remap-listen-btn,
  .remap-primary-btn {
    animation: none !important;
    transition: none !important;
  }
}
</style>
