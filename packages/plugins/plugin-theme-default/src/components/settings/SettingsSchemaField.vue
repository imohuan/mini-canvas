<script setup lang="ts">
/**
 * SettingsSchemaField —— 单个 schema 配置项的可复用控件渲染器（默认设置皮的字段级 UI）。
 *
 * 职责（只画一种控件 + 提交值，不背分组/布局）：
 * - 入参给 group + key + settings，每次渲染**现取**该字段的最新 entry（settings 非响应式，
 *   订阅 onChange 驱动本地版本号重渲染 → 值/气泡/开关态始终最新，不会用陈旧的 entry prop）。
 * - 按 entry.schema.type 渲染控件：color / number(滑块) / boolean(开关) / select / 其它(string)。
 * - 改控件 → settings.set(key, value)：高频(颜色拖动/滑块连续)用合帧 coalescer 收敛成一帧一次 set，
 *   文本/下拉一次即提交不需合帧（逻辑对齐原 PluginSettingsPanel，目标 B2 性能约束③）。
 * - 输入控件用 :value 受控，不因外部重渲染而重挂（避免打字丢焦点）。
 *
 * 用法：<SettingsSchemaField :group="g" :key="k" :settings="source" />（key = 字段 key，须在 groupOf(g) 内）。
 * 归属：plugin-theme-default 默认皮实现；canvas-render 抽象层不持具体控件。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingsPanelSource, SettingEntry, SettingSchema } from '@mini-canvas/canvas-render'
import { createCoalescer } from '@mini-canvas/canvas-render'
import Select from '../ui/Select.vue'

const props = defineProps<{
  /** 字段所属分组（须等于 settings.groupOf 的组名） */
  group: string
  /** 字段 key（在 groupOf(group) 内唯一）。命名为 fieldKey 以避免与 Vue 保留的 key 冲突 */
  fieldKey: string
  settings: SettingsPanelSource
}>()

// store 非 reactive：订阅变化驱动本地版本号，让 valueOf 每次重渲染取到最新值
const tick = ref(0)
let unsub: { dispose(): void } | undefined
onBeforeUnmount(() => unsub?.dispose())
onMounted(() => {
  unsub = props.settings.onChange(() => void (tick.value += 1))
  // 一次性自愈：number 滑块若历史已存了不在 step 网格上的小数（早期 Ctrl 细调 bug 遗留，
  // 如 step=1 字段存了 60.8），载入时吸附回网格，避免页面上残留 0.x。
  const e = props.settings.groupOf(props.group).find((x) => x.key === props.fieldKey)
  if (e && e.schema.type === 'number') {
    const v = numberValue(e.value, e.schema)
    const snapped = snapToGrid(v, baseStep())
    if (snapped !== v && Number.isFinite(v)) {
      set(e.key, snapped)
      coalescer.flush()
    }
  }
})

// 现取当前分组下本字段的最新 entry（每次渲染都重算，不缓存陈旧值）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entry = computed<SettingEntry | undefined>(() => {
  void tick.value
  return props.settings.groupOf(props.group).find((e) => e.key === props.fieldKey)
})

// 高频控件连续拖动 → 合帧成一帧一次 set；文本/下拉一次提交
const coalescer = createCoalescer((pairs) => {
  for (const [k, v] of pairs) props.settings.set(k, v as string | number | boolean)
})
onBeforeUnmount(() => coalescer.dispose())

function set(k: string, v: string | number | boolean): void {
  coalescer.push(k, v)
}
function numberValue(v: string | number | boolean, s: SettingSchema): number {
  return Number(v) || Number(s.default)
}

/** 按 step 决定保留几位小数：step>=1 取整；step<1 取 step 小数位数（去尾零，至少 0） */
function decimalsOfStep(step: number): number {
  if (!Number.isFinite(step) || step >= 1) return 0
  // 把 step 转成小数字符串数位数（处理 0.05 -> "0.05" -> 2；0.1 -> 1）
  const s = String(step).split('.')[1] ?? ''
  let n = 0
  for (const ch of s) {
    if (ch === '0') n++
    else { n++; break }
  }
  return n
}
/** 按 schema.step 格式化显示值：截掉超出 step 精度的小数位（只动展示，不动存储） */
function formatByStep(v: string | number | boolean, s: SettingSchema): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  const d = decimalsOfStep((s.step ?? 1) as number)
  return n.toFixed(d)
}

// —— number 滑块拖动的"灵敏度"控制 ——
// **圆球（thumb）= 视觉跟手**：拖动中圆球 1:1 跟指针走，真实反映你拖到了哪。
// **store value = 真实落库值**：按 ctrl 缩放后吸附到 schema.step 网格，松手时圆球对齐到该值。
//
// 这样：拖动时眼睛跟手不会觉得"卡"或"乱套"；松手落库永远是 step 网格上的干净值（整数）。
// 按住 Ctrl → 位移 ×0.1，圆球跟手不变，但值变化更慢 → 让你能精确停在 step 网格的某个格上。
const NORMAL_ZOOM = 1
const CTRL_ZOOM = 0.1
const dragging = ref(false) // 模板需响应（控制 thumbValue vs store value 谁驱动圆球）
let startClientX = 0 // 按下时指针 clientX（固定基准）
let startValue = 0 // 按下时的 store 值（已吸附 step 网格，固定基准）
let dragZoom = NORMAL_ZOOM // 本次拖动用的缩放（按下时锁定）
// 圆球视觉值：与 store 分离的 ref；模板在拖动期间用这个驱动 el.value，松手对齐 store
const thumbValue = ref<number>(0)
const rangeEl = ref<HTMLInputElement | null>(null)

/** 该字段的基准步进（schema.step，缺省 1） */
function baseStep(): number {
  return (entry.value?.schema as SettingSchema).step ?? 1
}

/** 量程跨度 max-min */
function rangeSpan(): number {
  const s = entry.value?.schema as SettingSchema
  return (Number(s.max) || 100) - (Number(s.min) || 0)
}

/** 把 x 吸附到 step 网格（以 0 为基准），并夹在 [min,max] 内，规整浮点尾巴 */
function snapToGrid(x: number, step: number): number {
  const s = entry.value?.schema as SettingSchema
  const min = Number(s.min) || 0
  const max = Number(s.max) || 100
  const snapped = Math.round(x / step) * step
  return Math.min(max, Math.max(min, Number(snapped.toFixed(3))))
}

/** 当前指针位置对应的"原生直接值"（整段量程内线性，未缩放） */
function rawValueAt(el: HTMLInputElement, clientX: number): number {
  const s = entry.value?.schema as SettingSchema
  const min = Number(s.min) || 0
  const max = Number(s.max) || 100
  const rect = el.getBoundingClientRect()
  if (!rect.width) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return min + ratio * (max - min)
}

/** 实时刷新 thumbValue：从 store value 同步（用于拖动外 / 初始化 / 松手对齐） */
function syncThumbFromStore(): void {
  if (!entry.value) return
  thumbValue.value = numberValue(entry.value.value, entry.value.schema)
}

function onRangePointerDown(e: PointerEvent): void {
  const target = e.currentTarget as HTMLInputElement
  if (!target) return
  dragging.value = true
  dragZoom = e.ctrlKey ? CTRL_ZOOM : NORMAL_ZOOM
  // 临时放宽 DOM step 校验，让圆球能连续跟手停在任意小数位置（视觉），松手再还原。
  // schema.step 始终不被持久修改，只改 DOM 元素的临时 step。
  target.step = 'any'
  const s = entry.value?.schema as SettingSchema
  // 基准 = 按下时的真实值（吸附过的），用于后续累加
  startValue = numberValue(entry.value ? entry.value.value : undefined, s)
  startClientX = e.clientX
  // 圆球立即跟到指针位置（点哪到哪的视觉）
  thumbValue.value = rawValueAt(target, e.clientX)
  try {
    target.setPointerCapture(e.pointerId)
  } catch {
    /* noop */
  }
}

function onRangePointerMove(e: PointerEvent): void {
  if (!dragging.value || !entry.value) return
  const el = e.currentTarget as HTMLInputElement
  if (!el.clientWidth) return
  const span = rangeSpan()
  // 圆球视觉 = 1:1 跟手（不缩放），看着舒服
  thumbValue.value = rawValueAt(el, e.clientX)
  // 落库值 = 按 zoom 缩放 + step 网格吸附
  const dx = e.clientX - startClientX
  const val = snapToGrid(startValue + (dx / el.clientWidth) * span * dragZoom, baseStep())
  set(entry.value.key, val)
}

function endRangeDrag(): void {
  if (!dragging.value) return
  dragging.value = false
  // 还原 DOM step 到 schema 原始值（不影响 schema 定义本身）
  const el = rangeEl.value
  if (el) el.step = String(baseStep())
  // 圆球对齐到最后落库的 step 网格值（避免松手圆球停在中间的"连续位置"）
  if (entry.value) syncThumbFromStore()
  coalescer.flush()
}

function onRangeKeydown(e: KeyboardEvent): void {
  // 方向键：每次 ± 一个 step（值保持在网格上，天然不会出格）
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!dir || !entry.value) return
  e.preventDefault()
  const step = baseStep()
  const cur = numberValue(entry.value.value, entry.value.schema)
  const val = snapToGrid(cur + dir * step, step)
  set(entry.value.key, val)
  coalescer.flush()
  const el = rangeEl.value
  if (el) el.value = String(val)
}
const fieldId = 'sf-' + props.fieldKey
</script>

<template>
  <div v-if="entry" class="sf-field">
    <!-- color -->
    <template v-if="entry.schema.type === 'color'">
      <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
      <div class="sf-row">
        <span class="sf-swatch">
          <input :id="fieldId" type="color" :value="String(entry.value)"
            @input="set(entry.key, ($event.target as HTMLInputElement).value)" />
        </span>
        <span class="sf-mon">{{ entry.value }}</span>
      </div>
    </template>

    <!-- number（滑块 + 数值气泡） -->
    <template v-else-if="entry.schema.type === 'number'">
      <div class="sf-label-row">
        <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
        <span class="sf-value-bubble">{{ formatByStep(entry.value, entry.schema) }}</span>
      </div>
      <input ref="rangeEl" :id="fieldId" class="sf-range" type="range" :min="entry.schema.min ?? 0"
        :max="entry.schema.max ?? 100" :step="entry.schema.step ?? 1"
        :value="dragging ? thumbValue : numberValue(entry.value, entry.schema)"
        @pointerdown="onRangePointerDown" @pointermove="onRangePointerMove"
        @pointerup="endRangeDrag" @pointercancel="endRangeDrag"
        @keydown="onRangeKeydown" />
    </template>

    <!-- boolean（toggle 开关） -->
    <template v-else-if="entry.schema.type === 'boolean'">
      <label class="sf-switch-row" :for="fieldId">
        <span class="sf-label">{{ entry.schema.label ?? entry.key }}</span>
        <span class="sf-switch">
          <input :id="fieldId" type="checkbox" :checked="!!entry.value"
            @change="set(entry.key, ($event.target as HTMLInputElement).checked)" />
          <span class="sf-slider"></span>
        </span>
      </label>
    </template>

    <!-- select（自绘下拉，替代原生 <select>） -->
    <template v-else-if="entry.schema.type === 'select'">
      <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
      <Select
        :input-id="fieldId"
        :model-value="String(entry.value)"
        :options="(entry.schema.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }))"
        placeholder="请选择"
        @update:model-value="set(entry.key, $event)"
      />
    </template>

    <!-- text（默认兜底 string/text） -->
    <template v-else>
      <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
      <input :id="fieldId" class="sf-text" type="text" :value="String(entry.value)"
        @input="set(entry.key, ($event.target as HTMLInputElement).value)" />
    </template>

    <!-- 字段描述（可选，schema.description 有才显示） -->
    <p v-if="entry.schema.description" class="sf-desc">{{ entry.schema.description }}</p>
  </div>
</template>

<style scoped>
.sf-field {
  padding: 14px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.sf-field:first-of-type {
  border-top: none;
}

.sf-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 8px;
}

.sf-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.sf-label-row .sf-label {
  margin-bottom: 0;
}

.sf-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* field description */
.sf-desc {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #9ca3af;
}

/* color swatch */
.sf-swatch {
  position: relative;
  width: 30px;
  height: 22px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.sf-swatch input[type='color'] {
  position: absolute;
  inset: -8px;
  width: 46px;
  height: 38px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: transparent;
}

/* number slider */
.sf-value-bubble {
  font-size: 11px;
  font-weight: 700;
  color: #0e7490;
  background: rgba(8, 145, 178, 0.12);
  padding: 1px 8px;
  border-radius: 999px;
}

.sf-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #0891b2, rgba(8, 145, 178, 0.25));
  outline: none;
  cursor: pointer;
}

.sf-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #0891b2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.sf-range::-webkit-slider-thumb:hover {
  border-color: #0e7490;
  transform: scale(1.05);
}

.sf-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #0891b2;
  cursor: pointer;
}

.sf-range:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 2px;
}

/* boolean toggle */
.sf-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  gap: 16px;
}

.sf-switch-row .sf-label {
  margin-bottom: 0;
}

.sf-switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.sf-switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
}

.sf-slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.16);
  transition: background 0.18s ease;
}

.sf-slider::before {
  content: '';
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.18s ease;
}

.sf-switch input:checked+.sf-slider {
  background: #0891b2;
}

.sf-switch input:checked+.sf-slider::before {
  transform: translateX(16px);
}

.sf-switch input:focus-visible+.sf-slider {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 2px;
}

/* text */
.sf-text {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #111827;
  background: rgba(0, 0, 0, 0.03);
  outline: none;
  font-family: inherit;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.sf-text:focus {
  border-color: rgba(8, 145, 178, 0.6);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.14);
  outline: none;
}

/* monospace value text */
.sf-mon {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #6b7280;
  font-weight: 600;
}
</style>
