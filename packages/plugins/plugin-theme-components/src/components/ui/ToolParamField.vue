<script setup lang="ts">
/**
 * ToolParamField —— 渲染"一个工具参数"（生成控制栏里的模型参数通用渲染器）。
 *
 * 这是"配置驱动 UI"的落地点：工具声明 `params`，本组件按声明渲染，**不认识任何业务概念**
 * （比例/分辨率/思考程度/风格都是同一套机制）。加一个参数不用改节点代码。
 *
 * 两条渲染路径：
 * 1. 内置控件（`type`）—— select / string / number / boolean，够用的场合零额外代码；
 * 2. **自定义组件**（`component`）—— 内置表达不了时（档位卡片、带缩略图的画廊…）
 *    工具作者自带组件，本组件只负责把 `modelValue` / `disabled` 喂进去、把
 *    `update:modelValue` 接到统一的值回写通道上。**面板与内核都不用改。**
 *
 * 依赖方向：本组件只认内核的 ToolParamDef 类型（纯类型 import）+ 本包自家 UI 组件，
 * 不反向依赖任何节点插件。
 */
import { computed, type Component } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@mini-canvas/ui-kit-shadcn'
import { resolvePresetKind, resolveBaseControl, gridColumns } from './paramKind'
import ToolOptionGrid from './ToolOptionGrid.vue'
import ToolRatioGrid from './ToolRatioGrid.vue'
import ToolParamSlider from './ToolParamSlider.vue'

const props = withDefaults(
  defineProps<{
    param: ToolParamDef
    /** 当前值（字符串化前的原值） */
    modelValue?: string | number | boolean
    disabled?: boolean
    /** 唯一 id 前缀（同一面板里多份参数时保证 label/for 唯一） */
    idPrefix?: string
  }>(),
  { modelValue: '', disabled: false, idPrefix: 'tp' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()

/** 自定义组件（opaque 句柄）；给了就走自定义路径 */
const custom = computed<Component | undefined>(() => props.param.component as Component | undefined)

/** 基础控件的形态（下拉 / 网格 / 滑块 / 数字 / 文本 / 开关） */
const base = computed(() => resolveBaseControl(props.param))

/**
 * 专属 UI（见 paramKind.ts）：目前只有比例网格。
 *
 * 只有基础控件画不出来的东西才配一个 kind；按钮网格、滑块、下拉都是基础控件。
 */
const preset = computed<Component | undefined>(() => {
  if (resolvePresetKind(props.param) === 'ratio') return ToolRatioGrid
  return undefined
})

/** 控件的列数：作者给的 `columns` 优先，否则按选项数自动排 */
const columns = computed(() => gridColumns(props.param, props.param.options?.length ?? 0))

/** 控件收到的 props（统一形状：param / modelValue / disabled / columns） */
const controlProps = computed<Record<string, unknown>>(() => ({
  param: props.param,
  modelValue: props.modelValue,
  disabled: props.disabled,
  columns: columns.value,
}))

/** select 的候选值（面板统一 Select 组件要的 {label,value} 形状） */
const options = computed(() => (props.param.options ?? []).map((o) => ({ label: o.label, value: o.value })))

/** 传给自定义组件的 props（约定名 + 作者附加的静态 props） */
const customProps = computed<Record<string, unknown>>(() => ({
  param: props.param,
  modelValue: props.modelValue,
  disabled: props.disabled,
  ...(props.param.componentProps ?? {}),
}))

const inputId = computed(() => `${props.idPrefix}-${props.param.key}`)

function onSelect(value: unknown): void {
  // reka-ui 的 Select 允许 null（清空）；这里按旧语义回成空串，别把 null 传给工具参数
  emit('update:modelValue', (value ?? '') as string | number)
}

function onNumber(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  const n = Number(raw)
  emit('update:modelValue', Number.isFinite(n) ? n : raw)
}

function onText(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onBool(value: boolean): void {
  emit('update:modelValue', value)
}

function onSlider(value: number): void {
  emit('update:modelValue', value)
}

/**
 * 值 → select 需要的字符串（Select 的 modelValue 是 string|number）。
 * 布尔类参数不该走 select，这里只在 select 分支被调用。
 */
const selectValue = computed<string | number>(() => {
  const v = props.modelValue
  return typeof v === 'number' ? v : String(v ?? '')
})

/**
 * 触发器上显示的当前选项文案。
 *
 * 为什么不用 SelectValue 自己推：reka-ui 的当前值标签来自「已经挂载过的选项」——
 * 浮层没打开过时它拿到的是空列表，于是首屏/收起态只剩占位符（实测：值已是 medium，
 * 触发器仍显示「思考程度」）。这里按 options 直接算出 label，语义与旧件一致。
 */
const selectLabel = computed(() => {
  const hit = options.value.find((o) => o.value === selectValue.value)
  return hit?.label ?? ''
})

const boolValue = computed(() => props.modelValue === true)
const textValue = computed(() => String(props.modelValue ?? ''))
const numberValue = computed(() => {
  const n = Number(props.modelValue)
  return Number.isFinite(n) ? n : 0
})
</script>

<template>
  <!-- 专属 UI（比例网格）优先；但仍不抢作者自带的 component -->
  <component
    :is="preset"
    v-if="preset && !custom"
    v-bind="controlProps"
    @update:model-value="(v: string | number | boolean) => emit('update:modelValue', v)"
  />

  <!-- 自定义组件优先：作者自带 UI 时完全交给他，本组件只接值 -->
  <component
    :is="custom"
    v-else-if="custom"
    v-bind="customProps"
    @update:model-value="(v: string | number | boolean) => emit('update:modelValue', v)"
  />

  <!--
    基础控件：按钮网格（点一下就切换）。
    这是**基础控件**不是专属 UI —— 「画质 / 分辨率 / 数量 / 运镜」这类语义都走它，
    列数由 `columns` 或选项数决定。
  -->
  <ToolOptionGrid
    v-else-if="base === 'grid' && !custom"
    v-bind="controlProps"
    @update:model-value="(v: string | number | boolean) => emit('update:modelValue', v)"
  />

  <!-- 内置：下拉（分离件：触发器 / 内容 / 选项各写各的，可任意定制） -->
  <Select
    v-else-if="base === 'select'"
    :model-value="selectValue"
    :disabled="disabled"
    @update:model-value="onSelect"
  >
    <SelectTrigger :id="inputId" size="sm" class="tpf-select" :aria-label="param.label || param.key">
      <SelectValue :placeholder="param.label || param.key">{{ selectLabel }}</SelectValue>
    </SelectTrigger>
    <SelectContent position="popper" side="bottom" :side-offset="4">
      <SelectItem v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
    </SelectContent>
  </Select>

  <!-- 内置：开关 -->
  <label v-else-if="base === 'boolean'" class="tpf-bool" :class="{ 'is-disabled': disabled }">
    <Switch
      :id="inputId"
      :model-value="boolValue"
      :disabled="disabled"
      @update:model-value="onBool"
    />
    <span class="tpf-bool-text">{{ param.label || param.key }}</span>
  </label>

  <!-- 基础控件：数值（有范围）→ 滑块 + 右侧数字框，`unit` 显示在标题后 -->
  <ToolParamSlider
    v-else-if="base === 'slider'"
    :param="param"
    :model-value="numberValue"
    :disabled="disabled"
    hide-title
    @update:model-value="onSlider"
  />

  <!-- 基础控件：数值（无范围）/ 文本 -->
  <Input
    v-else
    :id="inputId"
    class="tpf-input"
    :type="base === 'number' ? 'number' : 'text'"
    :value="base === 'number' ? numberValue : textValue"
    :placeholder="param.placeholder || param.label || param.key"
    :disabled="disabled"
    :aria-label="param.label || param.key"
    @change="base === 'number' ? onNumber($event) : onText($event)"
    @input="base === 'number' ? undefined : onText($event)"
  />
</template>

<style scoped>
/* 视觉照项目 UI 规范与设置界面：浅底 + 发丝边 + 圆角 8 */
.tpf-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--sf-input-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--sf-input-bg, rgba(0, 0, 0, 0.03));
  color: var(--sf-label, #111827);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.tpf-input:hover:not(:disabled) {
  background: var(--sf-input-bg-hover, rgba(0, 0, 0, 0.05));
}
.tpf-input:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.tpf-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tpf-input::placeholder {
  color: var(--sf-desc, #9ca3af);
}

/* 下拉触发器：跟随可用宽度（表单/参数面板里不该按内容收窄），外观交给 shadcn 与主题圆角 */
.tpf-select {
  width: 100%;
}

/* 开关：与设置界面的 Switch 同一件，只保留标签排版 */
.tpf-bool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.tpf-bool.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tpf-bool-text {
  color: var(--ui-ink, #374151);
  font-size: 12px;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .tpf-input {
    transition: none;
  }
}
</style>
