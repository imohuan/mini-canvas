<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ShortcutManager, type ShortcutHelpItem } from '../ShortcutManager'
import ShortcutKeys from './ShortcutKeys.vue'

const props = defineProps<{ item: ShortcutHelpItem }>()
const emit = defineEmits<{ close: [] }>()

const manager = ShortcutManager.getInstance()

/** 录制出的候选键位（尚未写入 manager，须点"完成"才生效） */
const newKeys = ref('')
/** 是否正在等待按键 */
const listening = ref(false)
/** 候选键位的冲突提示（录制阶段预检得出） */
const conflict = ref<string | null>(null)

/** 修饰键集合 — 也可能独立成为快捷键（如单用 Alt） */
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

/** 本次监听期间按过的所有修饰键（供纯修饰键收尾用） */
const allModifiersPressed = new Set<string>()

/** 本次监听期间是否已按下过非修饰键 */
let hasNonModifier = false

/** 纯修饰键长按保底计时器：Windows 单按 Alt 会抢焦点并吞掉 keyup，用它兜底 */
let modifierTimer: ReturnType<typeof setTimeout> | null = null

/** 候选键位是否与当前键位不同（有实际改动待提交） */
const dirty = () => newKeys.value !== props.item.keys

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

/** 纯修饰键 → 快捷键字符串（如 alt+shift） */
function formatModifiersOnly(modifiers: Set<string>): string {
  const parts: string[] = []
  const order = ['Control', 'Shift', 'Alt', 'Meta']
  for (const m of order) {
    if (modifiers.has(m)) parts.push(MODIFIER_ALIAS[m])
  }
  return parts.join('+')
}

/** 清空长按兜底计时器 */
function clearModifierTimer() {
  if (modifierTimer !== null) {
    clearTimeout(modifierTimer)
    modifierTimer = null
  }
}

/** 重置一组本地录制状态 */
function resetRecordingState() {
  listening.value = false
  conflict.value = null
  heldModifiers.clear()
  allModifiersPressed.clear()
  hasNonModifier = false
  clearModifierTimer()
}

function startListening() {
  if (listening.value) return
  listening.value = true
  newKeys.value = ''
  conflict.value = null
  heldModifiers.clear()
  allModifiersPressed.clear()
  hasNonModifier = false
  clearModifierTimer()
}

/**
 * 捕获一段候选键位并做只读冲突预检。
 * 注意：这里只"录下来"并提示可能冲突，绝不调用 manager.remap ——
 * 真正的写入要等用户点"完成"按钮，只有那时才算修改成功。
 */
function captureCandidate(keys: string) {
  newKeys.value = keys
  resetRecordingState()

  const result = manager.checkRemapConflict(props.item.id, keys)
  if (!result.ok && 'conflict' in result && result.conflict) {
    conflict.value = `与 "${result.conflict.entries[0]?.command || '其他快捷键'}" 冲突`
  } else if (result.ok && keys === props.item.keys) {
    // 与当前键位一致，无实际改动
    conflict.value = null
  }
}

/**
 * 纯修饰键长按兜底：持续按住修饰键（如 Alt）达到阈值仍未接普通键，
 * 就按"纯修饰组合"收尾 —— 修复 Windows 系统菜单吞掉 Alt 的 keyup 导致无法捕获的问题。
 */
function armModifierFallback() {
  clearModifierTimer()
  modifierTimer = setTimeout(() => {
    if (listening.value && heldModifiers.size > 0 && !hasNonModifier) {
      captureCandidate(formatModifiersOnly(heldModifiers))
    }
  }, 1300)
}

function handleKeyDown(e: KeyboardEvent) {
  if (!listening.value) return

  const keyName = e.key

  if (MODIFIER_KEYS.has(keyName)) {
    heldModifiers.add(keyName)
    allModifiersPressed.add(keyName)
    e.preventDefault()
    // 到 keyup 之间可能被系统吞掉，先武装一个保底
    armModifierFallback()
    return
  }

  // 非修饰键：按下即收尾（不依赖 keyup）
  clearModifierTimer()
  hasNonModifier = true
  e.preventDefault()
  e.stopPropagation()

  captureCandidate(formatShortcut(keyName, heldModifiers))
}

function handleKeyUp(e: KeyboardEvent) {
  if (!listening.value) return

  if (MODIFIER_KEYS.has(e.key)) {
    heldModifiers.delete(e.key)
    // 修饰键全部抬起且没按过普通键 → 纯修饰组合收尾
    if (heldModifiers.size === 0 && !hasNonModifier) {
      clearModifierTimer()
      captureCandidate(formatModifiersOnly(allModifiersPressed))
    }
  }
}

/** 录制中失焦（用户点到别处）→ 取消本次等待，避免按钮一直停在"等待按键" */
function handleWindowBlur() {
  if (listening.value) {
    listening.value = false
    clearModifierTimer()
    heldModifiers.clear()
    allModifiersPressed.clear()
    hasNonModifier = false
  }
}

/** 把"重置默认"设成候选（不立即写入），随"完成"一并提交 */
function resetToDefault() {
  clearModifierTimer()
  const defaultKey = manager.getDefaultKey(props.item.id)
  if (defaultKey !== undefined) {
    resetRecordingState()
    captureCandidate(defaultKey)
  }
}

/** 点"完成"：此刻才真正写入并算修改成功；有冲突则停留提示 */
function confirm() {
  // 无待提交改动 → 直接收起
  if (!dirty()) {
    emit('close')
    return
  }

  const keys = newKeys.value
  const result = manager.remap(props.item.id, keys)
  if (result.ok) {
    emit('close') // 父组件会刷新列表
  } else if ('conflict' in result && result.conflict) {
    conflict.value = `与 "${result.conflict.entries[0]?.command || '其他快捷键'}" 冲突`
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleWindowBlur)
  }
})

onUnmounted(() => {
  clearModifierTimer()
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('keyup', handleKeyUp, true)
    window.removeEventListener('blur', handleWindowBlur)
  }
})
</script>

<template>
  <!-- 面板占满整行；内层统一青色调，无白条 -->
  <div class="remap-panel" @pointerdown.stop>
    <div class="remap-panel-body">
      <div class="remap-panel-row">
        <span class="remap-panel-label">当前</span>
        <span class="remap-panel-value">
          <ShortcutKeys
            :keys="item.keys"
            :id-prefix="`cur-${item.id}`"
            :wrapper-class="'remap-keys-inline'"
          />
        </span>
      </div>

      <div class="remap-panel-row">
        <span class="remap-panel-label">新键位</span>
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
            <ShortcutKeys
              :keys="newKeys"
              :id-prefix="`new-${item.id}`"
              :wrapper-class="'remap-keys-newkey'"
              size="sm"
            />
          </template>
          <template v-else>
            点击录制新快捷键
          </template>
        </button>
      </div>
    </div>

    <div class="remap-panel-actions">
      <div class="remap-feedback-slot">
        <span v-if="conflict" class="remap-feedback-inline is-conflict">⚠ {{ conflict }}</span>
        <span v-else-if="newKeys && dirty()" class="remap-feedback-inline is-pending">点「完成」生效</span>
      </div>
      <div class="remap-actions-right">
        <button class="remap-text-btn" @click="resetToDefault" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
          </svg>
          重置默认
        </button>
        <button class="remap-text-btn" @click="startListening" :disabled="listening" type="button">
          重新录制
        </button>
        <button
          class="remap-confirm-btn"
          @click="confirm"
          :disabled="listening || !!conflict"
          type="button"
        >完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 面板：一张独立白底圆角卡，嵌在 canvas-menu-item 展开时的圆角盒内 */
.remap-panel {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #ffffff;
  border: 1px solid rgba(8, 145, 178, 0.16);
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  animation: remap-panel-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.remap-panel-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.remap-panel-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
}

/* 左右两行严格对齐：label 固定 48px，value 自适应延伸 */
.remap-panel-label {
  flex: 0 0 48px;
  font-size: 11px;
  font-weight: 700;
  color: #6b7280;
  letter-spacing: 0.04em;
}

.remap-panel-value {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

/* 录制按钮：在白底卡里做成"凹陷"感（浅灰底 + dashed 边） */
.remap-listen-btn {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  padding: 6px 12px;
  border: 1px dashed rgba(0, 0, 0, 0.18);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.remap-listen-btn:hover {
  border-color: rgba(8, 145, 178, 0.5);
  background: rgba(8, 145, 178, 0.06);
  color: #111827;
}

.remap-listen-btn.listening {
  border-style: solid;
  border-color: #0891b2;
  color: #0e7490;
  background: rgba(8, 145, 178, 0.1);
  animation: remap-pulse 1.2s ease-in-out infinite;
}

.remap-listen-btn.has-value {
  border-style: solid;
  border-color: rgba(0, 0, 0, 0.1);
  color: #111827;
  background: #ffffff;
}

.listening-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0891b2;
  margin-right: 6px;
  flex: 0 0 8px;
}

/* 快捷键 chip 与容器均抽离到 ShortcutKeys.vue，本文件仅保留布局微调 */
.remap-keys-inline {
  margin-right: 4px;
}

.remap-keys-newkey {
  /* 录制按钮内被压缩 */
}

/* 底部动作条：左信息 + 右按钮组，space-between 左右分立 */
.remap-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}

.remap-actions-right {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.remap-feedback-slot {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  font-size: 11px;
  font-weight: 700;
}

.remap-feedback-inline {
  padding: 4px 8px;
  border-radius: 6px;
}

.remap-feedback-inline.is-conflict {
  color: #b45309;
  background: rgba(245, 158, 11, 0.16);
}

.remap-feedback-inline.is-pending {
  color: #0e7490;
  background: rgba(8, 145, 178, 0.1);
}

.remap-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.remap-text-btn :deep(svg) {
  width: 12px;
  height: 12px;
}
.remap-text-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #111827;
}
.remap-text-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.remap-confirm-btn {
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
.remap-confirm-btn:hover {
  background: #0e7490;
}
.remap-confirm-btn:active {
  transform: scale(0.97);
}

@keyframes remap-panel-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes remap-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(8, 145, 178, 0.4); }
  50%      { box-shadow: 0 0 0 6px rgba(8, 145, 178, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .remap-panel,
  .remap-listen-btn,
  .remap-confirm-btn {
    animation: none !important;
    transition: none !important;
  }
}

/* 可交互元素聚焦时去掉浏览器默认黑框，改用贴合主题的青色 ring */
.remap-listen-btn,
.remap-text-btn,
.remap-confirm-btn {
  outline: none;
}
.remap-listen-btn:focus-visible,
.remap-text-btn:focus-visible,
.remap-confirm-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
</style>
