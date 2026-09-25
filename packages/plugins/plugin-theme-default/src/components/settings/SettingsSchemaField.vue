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
 *
 * number 滑块用自绘 <PrecisionSlider>（见 components/ui/PrecisionSlider.vue）：
 *   - 拖动期间由 slider 内部"本地值"当唯一视觉权威（同步、跟手不抖）；
 *   - 本组件气泡吃 slider 的 live 值实时刷新；真正写 store 只发生在 slider 松手的 `change` 事件，
 *     从而"视觉跟手"与"逻辑合帧提交"彻底解耦，不再有圆球回跳/闪烁/乱套。
 *
 * 用法：<SettingsSchemaField :group="g" :key="k" :settings="source" />（key = 字段 key，须在 groupOf(g) 内）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SettingsPanelSource, SettingEntry, SettingSchema } from '@mini-canvas/canvas-render'
import { createCoalescer } from '@mini-canvas/canvas-render'
import Select from '../ui/Select.vue'
import PrecisionSlider from '../ui/PrecisionSlider.vue'
import ColorField from '../ui/ColorField.vue'

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
  // 一次性自愈：number 若历史存了不在 step 网格上的小数（早期 bug 遗留），载入吸附回网格。
  const e = props.settings.groupOf(props.group).find((x) => x.key === props.fieldKey)
  if (e && e.schema.type === 'number') {
    const v = numberValue(e.value, e.schema)
    const snapped = snapNumber(v, e.schema)
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

// ===== number 滑块辅助 =====
/** step 小数位数（显示/吸附精度） */
function decimalCount(n: number): number {
  const s = String(n).split('.')[1]
  return s ? s.length : 0
}
/** 按 schema min/max/step 把 x 吸附到 step 网格并 clamp */
function snapNumber(x: number, s: SettingSchema): number {
  const min = Number(s.min) || 0
  const max = Number(s.max) || 100
  const step = Number(s.step) > 0 ? Number(s.step) : 1
  const dec = decimalCount(step)
  const k = 10 ** dec
  const val = Math.round((x - min) / step) * step + min
  return Math.min(max, Math.max(min, Math.round(val * k) / k))
}

// 拖动中的本地气泡值：slider 的 live 值实时刷新它，store 只收松手 change
const localNumber = ref(0)
// entry.value 变化（外部 set 后回读）时，非拖动期让本地气泡对齐 store
watch(
  entry,
  (e) => {
    if (e && e.schema.type === 'number') localNumber.value = numberValue(e.value, e.schema)
  },
  { immediate: true },
)
// 拖动中：live 值既更新本地气泡（跟手），也经 coalescer 写 store —— 让绑定的画布配置**实时生效**。
// 视觉权威仍在 PrecisionSlider 内部 local 值上（不经异步），所以每帧写 store 不会让圆球乱跑；
// coalescer 一帧合并一次 set，实时又省算力。松手 change 再做最终 commit（补 flush）。
function onSliderInput(v: number): void {
  localNumber.value = v
  if (!entry.value) return
  set(entry.value.key, snapNumber(v, entry.value.schema))
}
function onSliderChange(v: number): void {
  if (!entry.value) return
  localNumber.value = v
  const snapped = snapNumber(v, entry.value.schema)
  set(entry.value.key, snapped)
  coalescer.flush() // 松手确保这次值立即落库
}

const fieldId = 'sf-' + props.fieldKey
</script>

<template>
  <div v-if="entry" class="sf-field">
    <!-- color -->
    <template v-if="entry.schema.type === 'color'">
      <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
      <div class="sf-row">
        <ColorField
          :input-id="fieldId"
          :aria-label="entry.schema.label ?? entry.key"
          :model-value="String(entry.value)"
          @update:model-value="set(entry.key, $event)"
        />
      </div>
    </template>

    <!-- number（自绘滑块 + 数值气泡；Ctrl=精细，见 PrecisionSlider） -->
    <template v-else-if="entry.schema.type === 'number'">
      <div class="sf-label-row">
        <label class="sf-label" :for="fieldId">{{ entry.schema.label ?? entry.key }}</label>
        <span class="sf-value-bubble">{{ localNumber }}</span>
      </div>
      <PrecisionSlider
        :model-value="numberValue(entry.value, entry.schema)"
        :min="entry.schema.min ?? 0"
        :max="entry.schema.max ?? 100"
        :step="entry.schema.step ?? 1"
        :aria-label="entry.schema.label ?? entry.key"
        @update:model-value="onSliderInput"
        @change="onSliderChange"
      />
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
/* 字段样式全部走主题变量（--sf-* 由画布主题提供；缺失时回落到原来的亮色值）：
   之前这里整块硬编码亮色，暗色主题下标签几乎不可见。变量只改配色，不动结构/行为。 */
.sf-field {
  padding: 14px 0;
  border-top: 1px solid var(--sf-line, rgba(0, 0, 0, 0.06));
}

.sf-field:first-of-type {
  border-top: none;
}

.sf-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--sf-label, #111827);
  margin-bottom: 8px;
}

.sf-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
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
  color: var(--sf-desc, #9ca3af);
}

/* number bubble */
.sf-value-bubble {
  font-size: 11px;
  font-weight: 700;
  color: var(--sf-bubble-ink, #0e7490);
  background: var(--sf-bubble-bg, rgba(8, 145, 178, 0.12));
  padding: 1px 8px;
  border-radius: 999px;
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
  background: var(--sf-track, rgba(0, 0, 0, 0.16));
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
  background: var(--sf-thumb, #fff);
  box-shadow: 0 1px 2px var(--ui-shadow-md, rgba(0, 0, 0, 0.2));
  transition: transform 0.18s ease;
}

.sf-switch input:checked+.sf-slider {
  background: var(--sf-accent, #0891b2);
}

.sf-switch input:checked+.sf-slider::before {
  transform: translateX(16px);
}

.sf-switch input:focus-visible+.sf-slider {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 2px;
}

/* text */
.sf-text {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--sf-input-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--sf-label, #111827);
  background: var(--sf-input-bg, rgba(0, 0, 0, 0.03));
  outline: none;
  font-family: inherit;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.sf-text:focus {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  background: var(--sf-input-bg-focus, #fff);
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgba(8, 145, 178, 0.14));
  outline: none;
}

/* monospace value text */
.sf-mon {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--sf-desc, #6b7280);
  font-weight: 600;
}
</style>
