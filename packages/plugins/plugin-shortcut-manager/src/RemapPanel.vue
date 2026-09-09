<script setup lang="ts">
/**
 * RemapPanel —— 快捷键单条重映射面板（v2 复刻老版 shortcut-manager RemapPanel.vue）。
 *
 * 交互与原版完全一致：
 * - 展示「当前」键位（ShortcutKeys 键帽）；
 * - 「新键位」录制按钮：点击进入等待按键（捕获组合键/纯修饰键/长按兜底/失焦取消）；
 * - 录制后只读预检冲突并提示；点「完成」才真正写键；
 * - 「重置默认」把默认键设成候选，随「完成」一并提交。
 *
 * 数据源差异（v2）：老版走 ShortcutManager 单例按 id remap；v2 命令 keys 是唯一数据源，
 * 本面板经 ctx.get('shortcut-manager') 适配器把「命令某条键位」remap 到 CommandRegistry
 * （remapKeys/resetKeys，宿主统一分发立即生效；持久化经 shortcut-remap 引擎 save 落盘）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { V2ShortcutHelpItem, V2ShortcutManager } from './v2ShortcutManager'
import ShortcutKeys from './ShortcutKeys.vue'

const props = defineProps<{ item: V2ShortcutHelpItem }>()
const emit = defineEmits<{ close: [] }>()

const { ctx } = useCanvasRender()
const manager = ctx.get<V2ShortcutManager>('shortcut-manager')

/** 录制出的候选键位（尚未写入，须点"完成"才生效） */
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

/**
 * 修饰键判断顺序：ctrl → shift → alt → meta。
 * 顺序固定，保证展示稳定。
 */
const MOD_FLAGS: Array<[key: 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', alias: string]> = [
  ['ctrlKey', 'ctrl'],
  ['shiftKey', 'shift'],
  ['altKey', 'alt'],
  ['metaKey', 'meta'],
]

/** 纯修饰键 → 快捷键字符串（如 alt+shift） */
function formatModifiersOnly(modifiers: Set<string>): string {
  const parts: string[] = []
  const order = ['Control', 'Shift', 'Alt', 'Meta']
  for (const m of order) {
    if (modifiers.has(m)) parts.push(MODIFIER_ALIAS[m])
  }
  return parts.join('+')
}

/**
 * 由一次键盘事件组装快捷键字符串。
 * 修饰键以事件标志位为准（真实浏览器 Alt+A 组合键常不派发独立 Alt keydown）。
 */
function formatShortcutFromEvent(e: KeyboardEvent, key: string): string {
  const parts: string[] = []
  for (const [flag, alias] of MOD_FLAGS) {
    if (e[flag]) parts.push(alias)
  }
  parts.push(key.toLowerCase())
  return parts.join('+')
}

function clearModifierTimer() {
  if (modifierTimer !== null) {
    clearTimeout(modifierTimer)
    modifierTimer = null
  }
}

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

/** 捕获候选键位并做只读冲突预检（不写；写键等「完成」） */
function captureCandidate(keys: string) {
  newKeys.value = keys
  resetRecordingState()

  if (manager) {
    const result = manager.checkRemapConflict(props.item.commandId, keys)
    if (!result.ok && 'conflict' in result && result.conflict) {
      conflict.value = `与 "${result.conflict.entries[0]?.command || '其他快捷键'}" 冲突`
    } else if (result.ok && keys === props.item.keys) {
      conflict.value = null
    }
  }
}

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
    armModifierFallback()
    return
  }

  clearModifierTimer()
  hasNonModifier = true
  e.preventDefault()
  e.stopPropagation()

  captureCandidate(formatShortcutFromEvent(e, keyName))
}

function handleKeyUp(e: KeyboardEvent) {
  if (!listening.value) return

  if (MODIFIER_KEYS.has(e.key)) {
    heldModifiers.delete(e.key)
    if (heldModifiers.size === 0 && !hasNonModifier) {
      clearModifierTimer()
      captureCandidate(formatModifiersOnly(allModifiersPressed))
    }
  }
}

function handleWindowBlur() {
  if (listening.value) {
    listening.value = false
    clearModifierTimer()
    heldModifiers.clear()
    allModifiersPressed.clear()
    hasNonModifier = false
  }
}

/** 把"重置默认"设成候选（不立即写入），随"完成"一并提交。
 *  v2 无 per-combo 默认缓存 → 经适配器「把该命令该键位重置为默认」预演：先取当前默认键位串。
 *  适配器未缓存到默认时（命令从未 remap）→ 当前键即默认，no-op。 */
function resetToDefault() {
  clearModifierTimer()
  if (!manager) return
  // 默认键位：优先取 remapEngine 里记录的原始 keys 中同 combo 的一项；否则命令 originalKeys 当前匹配项
  const command = ctx.get<{ originalKeys(id: string): string[] | undefined } | undefined>('command')
  const orig = command?.originalKeys(props.item.commandId) ?? []
  const target = orig.find((k) => k.toLowerCase().replace(/\s+/g, '') === props.item.keys.toLowerCase().replace(/\s+/g, ''))
  if (target !== undefined) {
    resetRecordingState()
    captureCandidate(target)
  } else {
    // 无默认可回（原键即默认）：直接 no-op 收起
    emit('close')
  }
}

/** 点「完成」：此刻才真正写键并算修改成功；有冲突则停留提示 */
function confirm() {
  if (!dirty()) {
    emit('close')
    return
  }
  if (!manager) return
  const keys = newKeys.value
  const result = manager.remapCombo(props.item.commandId, props.item.keys, keys)
  if (result.ok) {
    emit('close')
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

onBeforeUnmount(() => {
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
          <ShortcutKeys :keys="item.keys" :id-prefix="`cur-${item.id}`" :wrapper-class="'remap-keys-inline'" />
        </span>
      </div>

      <div class="remap-panel-row">
        <span class="remap-panel-label">新键位</span>
        <button
          class="remap-listen-btn"
          :class="{ listening, 'has-value': !!newKeys && !listening }"
          @click="startListening"
          type="button"
        >
          <template v-if="listening">
            <span class="listening-dot" />等待按键…
          </template>
          <template v-else-if="newKeys">
            <ShortcutKeys :keys="newKeys" :id-prefix="`new-${item.id}`" :wrapper-class="'remap-keys-newkey'" size="sm" />
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
        <button class="remap-confirm-btn" @click="confirm" :disabled="listening || !!conflict" type="button">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.remap-keys-inline {
  margin-right: 4px;
}

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
