<script setup lang="ts">
/**
 * SettingsSchemaField —— 单个配置项的控件（默认设置皮的字段级 UI）。
 *
 * 只负责按 schema 画一种控件并提交值，不背分组和页面排版。
 * 控件统一用 @mini-canvas/ui-kit-shadcn 的原始组件：
 * Switch / Select / Input / Slider / NumberField / ColorPicker。
 *
 * 数字项：范围正常时用滑块；范围过大时换成步进输入框，免得细调拖不准。
 * 滑块拖动时先更新本地值，松手再补一次 flush，画面跟手、落库也不迟到。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SettingsPanelSource, SettingEntry, SettingSchema } from '@mini-canvas/canvas-render'
import { createCoalescer } from '@mini-canvas/canvas-render'
import {
  ColorPicker,
  Input,
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from '@mini-canvas/ui-kit-shadcn'
import { Minus, Plus } from 'lucide-vue-next'
import ShadcnSettingsRow from './ShadcnSettingsRow.vue'

const props = defineProps<{
  /** 字段所属分组（须等于 settings.groupOf 的组名） */
  group: string
  /** 字段 key（在 groupOf(group) 内唯一） */
  fieldKey: string
  settings: SettingsPanelSource
}>()

// store 不是响应式对象：订阅变化后递增版本号，让 entry 重新取值
const tick = ref(0)
let unsub: { dispose(): void } | undefined
onBeforeUnmount(() => unsub?.dispose())
onMounted(() => {
  unsub = props.settings.onChange(() => void (tick.value += 1))
  // 老数据可能不在 step 网格上，载入时吸附一次
  const item = props.settings.groupOf(props.group).find((x) => x.key === props.fieldKey)
  if (item && item.schema.type === 'number') {
    const value = numberValue(item.value, item.schema)
    const snapped = snapNumber(value, item.schema)
    if (snapped !== value && Number.isFinite(value)) {
      set(item.key, snapped)
      coalescer.flush()
    }
  }
})

/** 每次渲染现取，避免拿到旧 entry */
const entry = computed<SettingEntry | undefined>(() => {
  void tick.value
  return props.settings.groupOf(props.group).find((e) => e.key === props.fieldKey)
})

// 连续拖动/每键输入合并成一帧一次写，省得每个像素都落盘
const coalescer = createCoalescer((pairs) => {
  for (const [key, value] of pairs) props.settings.set(key, value as string | number | boolean)
})
onBeforeUnmount(() => coalescer.dispose())

function set(key: string, value: string | number | boolean): void {
  coalescer.push(key, value)
}

function numberValue(value: string | number | boolean, schema: SettingSchema): number {
  return Number(value) || Number(schema.default)
}

function decimalCount(n: number): number {
  const text = String(n).split('.')[1]
  return text ? text.length : 0
}

/** 按 min / max / step 吸附并夹取 */
function snapNumber(value: number, schema: SettingSchema): number {
  const min = Number(schema.min) || 0
  const max = Number(schema.max) || 100
  const step = Number(schema.step) > 0 ? Number(schema.step) : 1
  const scale = 10 ** decimalCount(step)
  const snapped = Math.round((value - min) / step) * step + min
  return Math.min(max, Math.max(min, Math.round(snapped * scale) / scale))
}

/** 滑块显示值：拖动时以本地值为准，避免异步写回让圆球回跳 */
const localNumber = ref(0)
watch(
  entry,
  (e) => {
    if (e && e.schema.type === 'number') localNumber.value = numberValue(e.value, e.schema)
  },
  { immediate: true },
)

/** 滑块回调可能给 undefined（清空/拖出边界），一律当 0 处理 */
function firstOf(value: number | number[] | undefined): number {
  if (Array.isArray(value)) return value[0] ?? 0
  return typeof value === 'number' ? value : 0
}

function onSliderInput(value: number | number[] | undefined): void {
  if (!entry.value) return
  const next = firstOf(value)
  localNumber.value = next
  set(entry.value.key, snapNumber(next, entry.value.schema))
}

function onSliderCommit(value: number | number[] | undefined): void {
  if (!entry.value) return
  const next = firstOf(value)
  localNumber.value = next
  set(entry.value.key, snapNumber(next, entry.value.schema))
  coalescer.flush()
}

function onNumberInput(value: number | undefined): void {
  if (!entry.value) return
  const next = typeof value === 'number' ? value : numberValue(entry.value.value, entry.value.schema)
  localNumber.value = next
  set(entry.value.key, snapNumber(next, entry.value.schema))
}

/** 数字项用步进框：范围过宽时滑块一小格就是几十，改用输入框 */
const useStepInput = computed<boolean>(() => {
  const schema = entry.value?.schema
  if (!schema) return false
  if ((schema as { input?: string }).input === 'number') return true
  const min = Number(schema.min ?? 0)
  const max = Number(schema.max ?? 100)
  return max - min > 1000
})

const fieldId = 'sf-' + props.fieldKey

/** 取色器展开态 */
const colorOpen = ref(false)
/** 当前颜色（取色器要一个字符串） */
const colorValue = computed<string>(() => String(entry.value?.value ?? ''))
/**
 * 取色器的初始颜色：不能写死色值（插件里不允许裸颜色）。
 * 空值表示“跟随主题”，这时从当前主题的强调色变量读一个真实颜色给取色器用。
 */
const pickerSeed = ref('')
function themeAccent(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim()
  return accent || ''
}
watch(
  colorOpen,
  (open) => {
    if (open && !pickerSeed.value) pickerSeed.value = themeAccent()
  },
  { immediate: true },
)
/** 取色器的值可能是字符串、颜色对象或 null；这里只收字符串，其它一律当清空 */
function onColor(value: string | { toString(): string } | null): void {
  if (!entry.value) return
  const next = typeof value === 'string' ? value : value === null ? '' : String(value)
  set(entry.value.key, next)
  coalescer.flush()
}
</script>

<template>
  <div v-if="entry" class="sf-field" :data-field="entry.key">
    <!-- 开关：左侧标题与说明，右侧 Switch -->
    <ShadcnSettingsRow
      v-if="entry.schema.type === 'boolean'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
    >
      <Switch
        :id="fieldId"
        :model-value="!!entry.value"
        :aria-label="entry.schema.label ?? entry.key"
        @update:model-value="set(entry.key, $event)"
      />
    </ShadcnSettingsRow>

    <!-- 下拉 -->
    <ShadcnSettingsRow
      v-else-if="entry.schema.type === 'select'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
    >
      <Select
        :model-value="String(entry.value)"
        @update:model-value="set(entry.key, String($event))"
      >
        <SelectTrigger
          class="sf-select-trigger"
          size="sm"
          :aria-label="entry.schema.label ?? entry.key"
        >
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in entry.schema.options ?? []"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label ?? option.value }}
          </SelectItem>
        </SelectContent>
      </Select>
    </ShadcnSettingsRow>

    <!-- 数字：滑块 + 数值框，或单独的步进框 -->
    <ShadcnSettingsRow
      v-else-if="entry.schema.type === 'number'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
      stacked
    >
      <div v-if="!useStepInput" class="sf-number">
        <Slider
          class="sf-slider"
          :model-value="[localNumber]"
          :min="entry.schema.min ?? 0"
          :max="entry.schema.max ?? 100"
          :step="entry.schema.step ?? 1"
          :aria-label="entry.schema.label ?? entry.key"
          @update:model-value="onSliderInput"
          @value-commit="onSliderCommit"
        />
        <NumberField
          class="sf-number-field"
          :model-value="localNumber"
          :min="entry.schema.min ?? 0"
          :max="entry.schema.max ?? 100"
          :step="entry.schema.step ?? 1"
          :format-options="{ useGrouping: false }"
          @update:model-value="onNumberInput"
        >
          <NumberFieldContent>
            <NumberFieldDecrement class="sf-number-btn">
              <Minus :size="12" />
            </NumberFieldDecrement>
            <NumberFieldInput
              class="sf-number-input"
              :aria-label="entry.schema.label ?? entry.key"
            />
            <NumberFieldIncrement class="sf-number-btn">
              <Plus :size="12" />
            </NumberFieldIncrement>
          </NumberFieldContent>
        </NumberField>
      </div>
      <NumberField
        v-else
        class="sf-number-field sf-number-field--wide"
        :model-value="numberValue(entry.value, entry.schema)"
        :min="entry.schema.min ?? 0"
        :max="entry.schema.max ?? 100"
        :step="entry.schema.step ?? 1"
        :format-options="{ useGrouping: false }"
        @update:model-value="onNumberInput"
      >
        <NumberFieldContent>
          <NumberFieldDecrement class="sf-number-btn">
            <Minus :size="12" />
          </NumberFieldDecrement>
          <NumberFieldInput
            class="sf-number-input"
            :aria-label="entry.schema.label ?? entry.key"
          />
          <NumberFieldIncrement class="sf-number-btn">
            <Plus :size="12" />
          </NumberFieldIncrement>
        </NumberFieldContent>
      </NumberField>
    </ShadcnSettingsRow>

    <!-- 颜色：色块 + 可折叠的取色器 -->
    <ShadcnSettingsRow
      v-else-if="entry.schema.type === 'color'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
      stacked
    >
      <Popover v-model:open="colorOpen">
        <div class="sf-color">
          <PopoverTrigger as-child>
            <button
              class="sf-color-trigger"
              type="button"
              :aria-label="'选择' + (entry.schema.label ?? entry.key)"
            >
              <span class="sf-color-swatch" :style="{ background: colorValue || 'transparent' }"></span>
              <span class="sf-color-hex">{{ colorValue || '跟随主题' }}</span>
            </button>
          </PopoverTrigger>
          <button
            v-if="(entry.schema as { optional?: boolean }).optional"
            class="sf-color-clear"
            type="button"
            title="清空（跟随主题强调色）"
            aria-label="清空颜色"
            @click="onColor('')"
          >
            清除
          </button>
        </div>
        <!-- 浮层挂在 body 上：滚动正文时不会被容器裁掉 -->
        <PopoverContent class="sf-color-pop" align="start" :side-offset="8">
          <ColorPicker
            :model-value="colorValue || pickerSeed"
            @update:model-value="onColor"
          />
        </PopoverContent>
      </Popover>
    </ShadcnSettingsRow>

    <!-- 文本（默认兜底） -->
    <ShadcnSettingsRow
      v-else
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
    >
      <Input
        :id="fieldId"
        class="sf-input"
        :model-value="String(entry.value)"
        :aria-label="entry.schema.label ?? entry.key"
        @update:model-value="set(entry.key, String($event))"
      />
    </ShadcnSettingsRow>
  </div>
</template>

<style scoped>
/* 相邻字段之间用一条很浅的线分开，不再给每项套卡片 */
.sf-field + .sf-field {
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.sf-select-trigger {
  width: 200px;
  max-width: 100%;
  border-radius: var(--radius-control, 8px);
}

.sf-input {
  width: 260px;
  max-width: 100%;
  height: 32px;
  border-radius: var(--radius-control, 8px);
}

.sf-number {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.sf-slider {
  flex: 1;
  min-width: 120px;
}

.sf-number-field {
  flex: 0 0 auto;
  width: 104px;
}

.sf-number-field--wide {
  width: 140px;
}

.sf-number-input {
  height: 30px;
  padding: 0 18px;
  border-radius: var(--radius-control, 8px);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.sf-number-btn {
  padding: 0 4px;
  color: var(--ui-ink-dim, #6b7280);
}

.sf-number-btn:hover {
  color: var(--ui-ink, #18202b);
}

.sf-color {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sf-color-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px 0 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.sf-color-trigger:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.05));
}

.sf-color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
}

.sf-color-hex {
  letter-spacing: 0.01em;
}

.sf-color-clear {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  cursor: pointer;
}

.sf-color-clear:hover {
  background: var(--ui-hover, rgb(0 0 0 / 0.05));
  color: var(--ui-ink, #18202b);
}

.sf-color-pop {
  width: auto;
  padding: 12px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-open, 12px);
}
</style>
