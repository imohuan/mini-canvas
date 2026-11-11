<script setup lang="ts">
/**
 * SettingsSchemaField —— 单个配置项的控件（默认设置皮的字段级 UI）。
 *
 * 只负责按 schema 画一种控件并提交值，不背分组和页面排版。
 * 控件统一用 @plume-canvas/ui-kit-shadcn 的原始组件：
 * Switch / Select / Input / Slider / NumberField / ColorPicker。
 *
 * 数字项统一「滑块 + 数字框（带 - / +）」：没有退化成纯输入的例外分支。
 * 超大范围 / 非整数步进也照样用滑块 —— 数字框可以直接键入精确值，
 * 滑块只负责快速粗调；两者共用同一套 min / max / step 吸附逻辑。
 * 滑块拖动时先更新本地值，松手再补一次 flush，画面跟手、落库也不迟到。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SettingsPanelSource, SettingEntry, SettingSchema } from '@plume-canvas/canvas-render'
import { createCoalescer } from '@plume-canvas/canvas-render'
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
} from '@plume-canvas/ui-kit-shadcn'
import { Minus, Plus } from 'lucide-vue-next'
import { componentConfig } from '@plume-canvas/ui-kit-shadcn'
import ShadcnSettingsRow from './ShadcnSettingsRow.vue'
import ThemeFontField from './ThemeFontField.vue'
import ThemeRadiusField from './ThemeRadiusField.vue'
import ThemeSizeField from './ThemeSizeField.vue'

/**
 * 设置面板里的控件也要跟全局「控件尺寸」走。
 *
 * 面板里的下拉 / 输入框是**直接 import** 组件库的，绕过了按名取件那层 size 注入；
 * 再加上模板里写死 `size="sm"`、CSS 里写死 30/32px 高度，所以用户把设置切到「大」时
 * 设置界面完全没反应（2026-11-05 实测）。
 * 现在：模板不写死档位，统一读 componentConfig（响应式），CSS 高度也改成读同一档的行高变量。
 */
const sizeTier = computed(() => componentConfig.size)

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

/**
 * 外观里的三个字段用专门控件（字体下拉 / 圆角单选 / 尺寸单选），形状和
 * 组件库预览页顶部那组一致；其余 select 仍是普通下拉。
 *
 * 为什么按 key 分发、不给 SettingSchema 加新类型：schema 是内核契约，
 * 多一个 UI 专用字段会让别的设置皮也去理解它；这里只认本主题自己的三个 key。
 */
const APPEARANCE_CONTROL: Readonly<Record<string, 'font' | 'fontFollow' | 'radius' | 'size'>> = {
  themeFont: 'font',
  themeHeadingFont: 'fontFollow',
  themeRadius: 'radius',
  themeSize: 'size',
}

const appearanceControl = computed(() =>
  entry.value ? APPEARANCE_CONTROL[entry.value.key] : undefined,
)
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

    <!--
      外观三件（字体 / 圆角 / 尺寸）：用专门的控件，形状与组件库预览页一致。
      圆角与尺寸是横排多选，独占一行（放右侧会挤成一列）。
    -->
    <ShadcnSettingsRow
      v-else-if="appearanceControl === 'font' || appearanceControl === 'fontFollow'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
    >
      <div class="sf-font">
        <ThemeFontField
          :model-value="String(entry.value)"
          :follow-label="appearanceControl === 'fontFollow' ? '跟随正文' : '跟随宿主'"
          :follow-hint="appearanceControl === 'fontFollow' ? '与正文字体保持一致' : '用项目原有字体栈'"
          :aria-label="entry.schema.label ?? entry.key"
          @update:model-value="set(entry.key, $event)"
        />
      </div>
    </ShadcnSettingsRow>

    <ShadcnSettingsRow
      v-else-if="appearanceControl === 'radius'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
      stacked
    >
      <ThemeRadiusField
        :model-value="String(entry.value)"
        @update:model-value="set(entry.key, $event)"
      />
    </ShadcnSettingsRow>

    <ShadcnSettingsRow
      v-else-if="appearanceControl === 'size'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
      stacked
    >
      <ThemeSizeField
        :model-value="String(entry.value)"
        @update:model-value="set(entry.key, $event)"
      />
    </ShadcnSettingsRow>

    <!-- 其它下拉：保持普通 Select -->
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
          :size="sizeTier"
          :aria-label="entry.schema.label ?? entry.key"
        >
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <!-- position=popper：避免 item-aligned 把选项层叠在触发器上；间距读「外观 → 浮层」 -->
        <SelectContent
          class="settings-floating-layer"
          position="popper"
          side="bottom"
        >
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

    <!-- 数字：滑块 + 数值框（带 - / +）。所有 number 字段只有这一种形式。 -->
    <ShadcnSettingsRow
      v-else-if="entry.schema.type === 'number'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
      stacked
    >
      <div class="sf-number">
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
    </ShadcnSettingsRow>

    <!-- 颜色：色块 + 可折叠的取色器 -->
    <ShadcnSettingsRow
      v-else-if="entry.schema.type === 'color'"
      :label="entry.schema.label ?? entry.key"
      :description="entry.schema.description"
    >
      <!--
        结构要点：清除角标和触发器必须是**同一个定位容器**的直接子元素。
        PopoverTrigger(as-child) 自己会渲染成一个占据整行的层，若把它和角标
        放在 .sf-color 里，角标只会挂在这个外壳的左上角、落不到色块上。
        所以把 Popover 放在 .sf-color 内层，角标挂到触发器旁边。
      -->
      <div class="sf-color">
        <Popover v-model:open="colorOpen">
          <PopoverTrigger as-child>
            <button
              class="sf-color-trigger"
              type="button"
              :aria-label="'选择' + (entry.schema.label ?? entry.key)"
              @keydown.delete.prevent="onColor('')"
              @keydown.backspace.prevent="onColor('')"
            >
              <span class="sf-color-swatch" :style="{ background: colorValue || 'transparent' }"></span>
              <span class="sf-color-hex">{{ colorValue || '跟随主题' }}</span>
            </button>
          </PopoverTrigger>
          <!--
            清除：**悬停触发器时**才在右上角浮出的小叉（用户口径 2026-11-02）。
            以前这里是常驻的「清除」文字按钮，占着右侧一整块，颜色行被迫改成上下布局。
            现在只占 16px 的角标，鼠标离开即隐藏，行内也不需要再多一个按钮位。
            键盘用户：Tab 到触发器后按 Delete / Backspace 同样可清空（见模板上的 keydown）。
          -->
          <button
            v-if="(entry.schema as { optional?: boolean }).optional && colorValue"
            class="sf-color-clear"
            type="button"
            title="清除自定义颜色，改用主题色"
            aria-label="清除自定义颜色，改用主题色"
            @click="onColor('')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <!-- 浮层挂在 body 上：滚动正文时不会被容器裁掉；抬到设置遮罩之上 -->
          <PopoverContent class="sf-color-pop settings-floating-layer" align="start">
            <ColorPicker
              :model-value="colorValue || pickerSeed"
              @update:model-value="onColor"
            />
          </PopoverContent>
        </Popover>
      </div>
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
        :placeholder="entry.schema.placeholder"
        :aria-label="entry.schema.label ?? entry.key"
        @update:model-value="set(entry.key, String($event))"
      />
    </ShadcnSettingsRow>
  </div>
</template>

<style scoped>
.sf-field + .sf-field {
  /* 分割线由 ShadcnSettingsRow 的相邻兄弟规则提供；这里不再重复画一条 */
  border-top: 0;
}

.sf-select-trigger {
  width: 200px;
  max-width: 100%;
}

/* 字体下拉：右侧同宽的一列，太窄会把字体名截断 */
.sf-font {
  width: 220px;
  max-width: 100%;
}

.sf-input {
  width: 260px;
  max-width: 100%;
  /* 高度交给全局控件尺寸：Input 自带 h-9，写死 32px 会让「小 / 大」档失效 */
  height: auto;
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

.sf-number-input {
  /* 高度跟着全局尺寸档（NumberField 自己按 size 出 h-8/9/10），只保留左右留白 */
  padding: 0 18px;
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
  /*
   * 清除角标相对于 **触发器外壳** 定位。之前挂在 .sf-color 上，
   * 而 PopoverTrigger(as-child) 会把触发器变成一个独立层，
   * 角标反而跑到行外去了（实测坐标 x=88 / y=-6）。
   * 现在 .sf-color-trigger 自己是 position: relative，角标就贴在它右上角。
   */
  position: relative;
  display: flex;
  align-items: center;
}

.sf-color-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  /* 给角标留出右侧空间：清除按钮压在色块内侧，不再盖住 hex 文本 */
  position: relative;
  /* 高度跟设置行一起走（--plume-size-control-h 由尺寸档位写入） */
  height: calc(var(--plume-size-control-h, 2.25rem) - 4px);
  padding: 0 10px 0 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  /* 圆角交给组件库：全局圆角档位改的是 [data-slot] 本体，
     这里写死 var(--radius-control) 会把它盖住（用户 2026-11-02 反馈「圆角没生效」）。 */
  border-radius: var(--plume-radius, var(--radius-control, 8px));
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

/*
 * 清除角标：放在触发器右上角，只在鼠标进入（或键盘聚焦）这一行时出现。
 * 用 absolute 让它不占布局宽度 —— 颜色行才能保持「标题在左、控件在右」。
 * opacity + visibility 过渡，而不是 display:none，出现时不会跳一下。
 */
.sf-color-clear {
  position: absolute;
  /*
   * 贴在触发器右上角轮廓上：一半在控件内、一半在外，鼠标悬停时一眼能看见，
   * 又不遮住色块与右侧 hex。卡片右侧有 16px 内衬，不会被裁掉。
   */
  top: -6px;
  right: -6px;
  z-index: 1;
  width: 13px;
  height: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 999px;
  background: var(--ui-overlay-solid, var(--ui-panel, #fff));
  color: var(--ui-ink-dim, #6b7280);
  box-shadow: 0 1px 2px var(--ui-scrim, rgb(15 23 42 / 0.18));
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  /* 不可见时不参与点击，避免它盖在色块上方挡住「打开取色器」 */
  pointer-events: none;
  transition: opacity 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.sf-color-clear svg {
  width: 8px;
  height: 8px;
}

/*
 * 只认「鼠标在触发器上」或「键盘焦距在触发器 / 角标上」。
 * 不能写 .sf-color:hover —— 角标本身是 .sf-color 的后代，鼠标移到角标上时它也算 hover，
 * 结果移开控件后小叉一直亮着（实测）。
 */
.sf-color-trigger:hover + .sf-color-clear,
.sf-color-trigger:focus-visible + .sf-color-clear,
.sf-color-clear:hover,
.sf-color-clear:focus-visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.sf-color-clear:hover {
  border-color: var(--ui-danger, #ef4444);
  color: var(--ui-danger, #ef4444);
}

.sf-color-pop {
  width: 272px;
  padding: 16px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--plume-radius, var(--radius-open, 12px));
}
</style>
