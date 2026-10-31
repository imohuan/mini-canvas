<script setup lang="ts">
/**
 * Select —— 默认主题对 @mini-canvas/ui-kit Select 的**薄适配层**。
 *
 * ui-kit 的 Select 内部已经使用同一个 Dropdown（定位、互斥、外点/Esc、键盘高亮），
 * 这里只保留默认皮原有的 props 与外观钩子，不再维护第二套浮层。
 *
 * 用法：
 *   <Select v-model="v" :options="[{value:'lr',label:'左→右'},…]" placeholder="请选择" searchable />
 */
import { Select as UiKitSelect } from '@mini-canvas/ui-kit'
import type { SelectOption } from './types'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    options?: SelectOption[]
    searchable?: boolean
    placeholder?: string
    searchPlaceholder?: string
    placement?: string
    /** 'match' = 浮层与触发框同宽；'auto' = 内容自适应；其它字符串 = CSS 宽度 */
    dropdownWidth?: string
    dropdownMaxWidth?: string
    /** 浮层最小宽度（只在 dropdownWidth:'match' 时生效；缺省 200px） */
    dropdownMinWidth?: string
    /** 浮层最大高度（超出就在浮层内滚动；缺省 320px） */
    dropdownMaxHeight?: string
    /** 供设置表单给输入框 id（label for 关联） */
    inputId?: string
  }>(),
  {
    modelValue: '',
    options: () => [],
    searchable: false,
    placeholder: '请选择',
    searchPlaceholder: '搜索...',
    placement: 'bottom-start',
    dropdownWidth: 'auto',
    dropdownMaxWidth: '320px',
    dropdownMinWidth: '200px',
    dropdownMaxHeight: '320px',
    inputId: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

/** 旧版 modelValue 不接受 null；ui-kit 的清空路径会发 null，这里回成空串（与旧语义一致）。 */
function onUpdate(value: string | number | null): void {
  emit('update:modelValue', value ?? '')
}
function onChange(value: string | number | null): void {
  emit('change', value ?? '')
}
</script>

<template>
  <div class="sel-root">
    <UiKitSelect
      :model-value="modelValue"
      :options="props.options as never"
      :searchable="searchable"
      :placeholder="placeholder"
      :search-placeholder="searchPlaceholder"
      :placement="placement as never"
      :dropdown-width="dropdownWidth"
      :dropdown-max-width="dropdownMaxWidth"
      :dropdown-min-width="dropdownMinWidth"
      :dropdown-max-height="dropdownMaxHeight"
      :input-id="inputId"
      body-class="sel-menu-body"
      :menu-max-height="dropdownMaxHeight"
      @update:model-value="onUpdate"
      @change="onChange"
    />
  </div>
</template>

<style>
/*
 * 旧主题 Select 的菜单外观变量：浮层由 ui-kit 的 Dropdown 渲染，
 * 这里通过 bodyClass 把 --dd-* 交给它，避免再写一份面板样式。
 */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid, #fff);
}

/*
 * 默认皮的触发器/选项外观钩子。
 *
 * ui-kit Select 自带 .mck-select 结构与状态；这里只把默认皮原有的输入框观感
 * （表单里比工具栏更轻的底色与描边）贴到同一批元素上，避免两套结构。
 * 浮层外观由 ui-kit 的 Dropdown 负责，不在本文件重复。
 */
.sel-root .sel-trigger {
  width: 100%;
}

.sel-root .mck-select {
  border-color: var(--sf-input-line, var(--ui-line));
  background: var(--sf-input-bg, var(--ui-veil));
  color: var(--sf-label, var(--ui-ink));
}

/* 旧调用方面向“触发器”的可见类名：ui-kit Select 的触发器就是那个 button。 */
.sel-root .mck-select.sel-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.sel-root .mck-select:hover:not(:disabled) {
  background: var(--sf-input-bg-hover, var(--ui-hover));
}

.sel-root .mck-select.is-open {
  border-color: var(--ui-accent);
  background: var(--sf-input-bg-focus, var(--ui-panel));
  box-shadow: 0 0 0 3px var(--ui-accent-soft);
}

.sel-root .mck-select__option.is-selected {
  color: var(--ui-ink);
}

/* 旧调用方按这组 token 检查“菜单与右键菜单同档”；ui-kit 浮层直接消费它们。 */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid);
}

/* ==== 右键菜单同款行（用户口径 2026-10-12：下拉完全参考右键菜单）====
 * 结构仍由 ui-kit Select 提供，这里只把默认皮的 .sel-* 行外观贴上去。
 */
.sel-menu-body .mck-select__option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-ink-dim, #374151);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: sel-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}

/* 旧调用方按这组 token 检查“菜单与右键菜单同档”；ui-kit 浮层直接消费它们。 */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid);
}

.sel-menu-body .mck-select__option:hover,
.sel-menu-body .mck-select__option.is-highlight {
  background: var(--ui-hover);
}

.sel-menu-body .mck-select__option.is-group-start {
  position: relative;
  margin-top: 11px;
}

.sel-menu-body .mck-select__option.is-group-start::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: -6px;
  height: 1px;
  background: var(--ui-line);
}

/* 名称/描述绝对定位两行：行高必须钉在 1，否则父级行高会让两行叠住。 */
.sel-menu-body .mck-select__copy {
  position: relative;
  display: block;
  flex: 1;
  min-width: 0;
  min-height: 32px;
  align-self: stretch;
  overflow: hidden;
}

.sel-menu-body .mck-select__option-label {
  position: absolute;
  top: 50%;
  left: 0;
  max-width: 100%;
  overflow: hidden;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateY(-50%);
}

.sel-menu-body .mck-select__option-label {
  line-height: 1;
}

.sel-menu-body .mck-select__option-desc {
  position: absolute;
  left: 0;
  bottom: 3px;
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-ink-dim, #9ca3af);
  font-size: 11px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.sel-menu-body .mck-select__option:hover .mck-select__option-label,
.sel-menu-body .mck-select__option:focus-within .mck-select__option-label {
  top: 3px;
  transform: translateY(0);
}

.sel-menu-body .mck-select__option:hover .mck-select__option-desc,
.sel-menu-body .mck-select__option:focus-within .mck-select__option-desc {
  opacity: 1;
  transform: translateY(0);
}

@keyframes sel-item-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/*
 * 旧版 Select 的行外观（44 高 / 6 内边距 / 10 圆角 / 行内 10），数值照右键菜单。
 * ui-kit 的默认行是紧凑档（38 高）；默认皮在设置面板 / 参数面板里需要更大的点击区，
 * 因此仍由主题这一层加规格，而不是把两处行高统一成一种。
 */
.sel-root .sel-option {
  min-height: 44px;
  gap: 10px;
  padding: 6px;
  border-radius: 10px;
  color: var(--dd-ink, var(--ui-ink-dim));
  font-weight: 500;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: sel-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}

.sel-root .sel-option:hover,
.sel-root .sel-option.is-highlight {
  background: var(--ui-hover);
}

.sel-root .sel-option.is-active {
  color: var(--ui-ink);
  font-weight: 600;
}

.sel-root .sel-option.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.sel-root .sel-option:focus-visible {
  outline: 2px solid var(--ui-accent-ring);
  outline-offset: -1px;
}

.sel-root .sel-option-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--ui-ink-dim);
  background: var(--ui-veil);
}

.sel-root .sel-option-icon :deep(svg),
.sel-root .sel-option-icon svg {
  width: 16px;
  height: 16px;
}

.sel-root .sel-option-label {
  line-height: 1;
}

.sel-root .sel-option-description {
  line-height: 1;
}

.sel-root .sel-option-copy {
  min-height: 32px;
  position: relative;
  overflow: hidden;
}

.sel-root .sel-option-label {
  position: absolute;
  top: 50%;
  left: 0;
  max-width: 100%;
  transform: translateY(-50%);
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}

.sel-root .sel-option.hasDescription:hover .sel-option-label,
.sel-root .sel-option.hasDescription:focus-within .sel-option-label {
  top: 3px;
  transform: translateY(0);
}

.sel-root .sel-option-description {
  position: absolute;
  left: 0;
  bottom: 3px;
  max-width: 100%;
  color: var(--ui-ink-dim);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.sel-root .sel-option.hasDescription:hover .sel-option-description,
.sel-root .sel-option.hasDescription:focus-within .sel-option-description {
  opacity: 1;
  transform: translateY(0);
}

.sel-root .sel-check {
  width: 16px;
  height: 16px;
  color: var(--ui-ink-dim);
}

.sel-root .sel-option.is-group-start {
  margin-top: 11px;
  position: relative;
}

.sel-root .sel-option.is-group-start::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: -6px;
  height: 1px;
  background: var(--ui-line);
}

.sel-root .sel-list::-webkit-scrollbar {
  width: 8px;
}
.sel-root .sel-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb);
}
.sel-root .sel-list::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover);
}

@keyframes sel-item-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .sel-root .sel-trigger,
  .sel-root .sel-arrow,
  .sel-root .sel-option,
  .sel-root .sel-option-label,
  .sel-root .sel-option-description {
    animation: none !important;
    transition: none !important;
  }
}

/* 旧调用方/测视按这组 token 检查“菜单与右键菜单同档”；ui-kit 浮层直接消费它们。 */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid);
}
</style>
