<script setup lang="ts">
/**
 * PrecisionSlider —— 可复用"精确步进"滑块（主题默认皮肤 UI 原语）。
 *
 * 相比裸 `<input type=range>`，这里自绘轨道+圆球并用 Pointer Events 接管拖动，彻底绕开原生
 * range 的三大坑：① 非 step 网格的 value 浏览器不帮你吸附、thumb 与 value 可能不一致；
 * ② 受控 value 走异步合并器时 thumb 滞后/回跳；③ "圆球位置"和"逻辑值"容易各自为政。
 *
 * 本组件的设计原则（业界 radix/reka/pascalorg 通行做法）：
 * - **圆球位置 = 值的纯函数** `percent = (v-min)/(max-min)*100`，绝不单独存"圆球位置"，
 *   所以"圆球跟 value 脱节/乱跑"在结构上不可能发生。
 * - **拖动期间内部 local 值当唯一视觉权威**（同步更新，不经任何异步合并），因此跟手不抖。
 * - **parent/store 只收 `change`（松手一次）**；`update:modelValue` 仅作实时预览（可选）。
 * - **值永远吸附在 step 网格上**（step=1 → 整数），吸附在"每帧增量换算"里做。
 * - **Ctrl = 精细**：拖动灵敏度 ×0.1（同样位移只走十分之一），能精确停在某个整数格；
 *   Shift = 大步 ×10。中途按/放修饰键会 **re-anchor（重置锚点）**，不跳回起点。
 * - 键盘 a11y：←/→ = ±step，Shift+←/→ 或 PageUp/PageDown = 大步（(max-min)/10），Home/End = min/max。
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min: number
    max: number
    step?: number
    /** 步长乘子：ctrl 默认 0.1（细），shift 默认 10（粗） */
    ctrlMultiplier?: number
    shiftMultiplier?: number
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    step: 1,
    ctrlMultiplier: 0.1,
    shiftMultiplier: 10,
    disabled: false,
    ariaLabel: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  /** 松手一次：真正写 store / undo 的唯一通道 */
  change: [value: number]
}>()

// ---- 吸附 / 百分比 纯工具（step 小数位修正浮点误差）----
function decimalCount(n: number): number {
  const s = String(n).split('.')[1]
  return s ? s.length : 0
}
function snap(v: number): number {
  const step = props.step > 0 ? props.step : 1
  const dec = decimalCount(step)
  const k = 10 ** dec
  // 以 min 为 step 基累加，clamp 到 [min,max]，规整浮点尾巴
  const raw = Math.round(((v - props.min) / step) * k) / k
  const val = raw * step + props.min
  return Math.min(props.max, Math.max(props.min, Math.round(val * k) / k))
}
function clampPct(p: number): number {
  return Math.min(100, Math.max(0, p))
}
const valueToPct = (v: number): number =>
  props.max > props.min ? clampPct(((v - props.min) / (props.max - props.min)) * 100) : 0
const pctToValue = (p: number): number => props.min + (p / 100) * (props.max - props.min)

/** 显示值（供气泡等）：按 step 小数位截断 */
const displayValue = computed(() => {
  const dec = decimalCount(props.step > 0 ? props.step : 1)
  return Number(modelLocal.value.toFixed(Math.max(dec, 0)))
})

// ---- 内部状态 ----
// 视觉与实时显示的"本地权威值"：拖动期间同步更新（不走异步），平时跟随 modelValue。
const modelLocal = ref(snap(props.modelValue))
// 圆球/进度百分比：完全由 modelLocal 派生，无第二份位置状态
const percent = computed(() => valueToPct(modelLocal.value))

const dragging = ref(false)
const rootEl = ref<HTMLElement | null>(null)

// 拖动锚点：按下次拖动/换修饰键时重置
let anchor = { clientX: 0, value: 0, multiplier: 1 }

function stepMultiplier(e: PointerEvent | KeyboardEvent): number {
  if (e.shiftKey) return props.shiftMultiplier
  if (e.ctrlKey || e.metaKey || e.altKey) return props.ctrlMultiplier
  return 1
}

function valueFromPointer(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect()
  if (!rect.width) return modelLocal.value
  const pct = clampPct(((clientX - rect.left) / rect.width) * 100)
  return pctToValue(pct)
}

// ---- 指针拖动 ----
function onPointerDown(e: PointerEvent): void {
  if (props.disabled) return
  if (e.button !== 0) return
  const el = rootEl.value
  if (!el) return
  e.preventDefault()
  dragging.value = true
  anchor = { clientX: e.clientX, value: snap(props.modelValue), multiplier: stepMultiplier(e) }
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    /* noop */
  }
  // 点按轨道：普通(无修饰键)直接跳到该处；带修饰键则把该处当锚，细拖从当前位置走
  if (anchor.multiplier === 1) {
    modelLocal.value = snap(valueFromPointer(el, e.clientX))
    emitLive()
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return
  const el = rootEl.value
  if (!el) return
  const m = stepMultiplier(e)
  // 修饰键中途变化 → re-anchor，防止"按新步长从旧锚点回算"导致跳回起点
  if (m !== anchor.multiplier) {
    anchor = { clientX: e.clientX, value: modelLocal.value, multiplier: m }
    return
  }
  if (m === 1) {
    // 普通：圆球/值 1:1 跟指针（直觉，整段轨道 = 全量程）
    modelLocal.value = snap(valueFromPointer(el, e.clientX))
  } else {
    // 精细/大步：相对锚点位移 × 乘子（0.1 细 / 10 粗），从锚点值累加并吸附网格。
    // 基准与普通一致（满轨道=全量程），只缩放乘子 → 同样物理拖动 ctrl 只走十分之一，便于精确停格。
    const span = props.max - props.min
    if (span <= 0) return
    const dxPct = ((e.clientX - anchor.clientX) / el.clientWidth) * 100
    modelLocal.value = snap(anchor.value + (dxPct / 100) * span * m)
  }
  emitLive()
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  const el = rootEl.value
  if (el) {
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }
  commit()
}

/** 拖动中实时预览（父层如愿意可拿来更新气泡，但绝不可作为圆球位置来源） */
function emitLive(): void {
  emit('update:modelValue', displayValue.value)
}

/** 松手：一次性提交（写 store / undo 的入口） */
function commit(): void {
  const v = displayValue.value
  emit('update:modelValue', v)
  emit('change', v)
}

// 外部稳态值变化：非拖动期才吸收（拖动期本地值是权威）
watch(
  () => props.modelValue,
  (v) => {
    if (!dragging.value) modelLocal.value = snap(Number.isFinite(v) ? v : props.min)
  },
)

// ---- 键盘 a11y ----
function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return
  const step = props.step > 0 ? props.step : 1
  const bigStep = (props.max - props.min) / 10
  let dir = 0
  let delta = step
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1
  else if (e.key === 'PageDown') {
    dir = -1
    delta = bigStep
  } else if (e.key === 'PageUp') {
    dir = 1
    delta = bigStep
  } else if (e.key === 'Home') {
    modelLocal.value = snap(props.min)
    commit()
    return
  } else if (e.key === 'End') {
    modelLocal.value = snap(props.max)
    commit()
    return
  }
  if (dir === 0) return
  e.preventDefault()
  const m = stepMultiplier(e)
  modelLocal.value = snap(modelLocal.value + dir * delta * m)
  commit()
}
</script>

<template>
  <div
    ref="rootEl"
    class="ps"
    :class="{ 'is-dragging': dragging, 'is-disabled': disabled }"
    role="slider"
    tabindex="0"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelLocal"
    :aria-valuetext="String(displayValue)"
    :aria-disabled="disabled || undefined"
    :aria-label="ariaLabel || undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <!-- 已填充部分 -->
    <div class="ps-track">
      <div class="ps-fill" :style="{ width: percent + '%' }"></div>
    </div>
    <!-- 圆球：位置完全由 percent 派生，绝不另存 -->
    <div class="ps-thumb" :style="{ left: percent + '%' }"></div>
  </div>
</template>

<style scoped>
.ps {
  position: relative;
  width: 100%;
  height: 20px; /* 触控热区高度；轨道内居中 */
  cursor: pointer;
  outline: none;
  touch-action: none;
}
.ps.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ps-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 5px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.ps-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #0891b2, rgba(8, 145, 178, 0.7));
}
.ps-thumb {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #0891b2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
  transform: translate(-50%, -50%);
  transition: border-color 0.18s ease;
  box-sizing: border-box;
}
.ps:hover .ps-thumb,
.ps.is-dragging .ps-thumb {
  border-color: #0e7490;
}
.ps:focus-visible .ps-thumb {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 2px;
}
</style>
