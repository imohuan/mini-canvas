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
 * 默认主题给 ui-kit Select 上的“皮”：结构、定位、键盘交互都在 ui-kit，这里只写外观。
 * 浮层会被 Teleport 到 body（外点关闭靠这一点），所以菜单相关的规则一律挂在
 * `.sel-menu-body` 上，不能写成 `.sel-root ...` —— 那种写法根本匹配不到浮层。
 */

/** 浮层容器：与右键菜单同档（不透明白底 / 16 圆角 / 6 内边距） */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid);
}

/** 触发器：表单里比工具栏更轻的一档底色 */
.sel-root .sel-trigger {
  width: 100%;
}

.sel-root .mck-select {
  border-color: var(--sf-input-line, var(--ui-line));
  background: var(--sf-input-bg, var(--ui-veil));
  color: var(--sf-label, var(--ui-ink));
}

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

/**
 * 菜单行：44 高 / 6 内边距 / 10 圆角 / 行内 10，数值照右键菜单。
 * ui-kit 默认行是紧凑档（38）；设置面板和参数面板需要更大的点击区，由主题这一层加规格。
 * 选中不铺色，靠字重与勾 —— 与右键菜单一致。
 */
.sel-menu-body .sel-option {
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
  color: var(--ui-ink-dim);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: sel-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}

.sel-menu-body .sel-option:hover,
.sel-menu-body .sel-option.is-highlight {
  background: var(--ui-hover);
}

.sel-menu-body .sel-option.is-active {
  color: var(--ui-ink);
  font-weight: 600;
}

.sel-menu-body .sel-option.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.sel-menu-body .sel-option-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--ui-ink-dim);
  background: var(--ui-veil);
}

.sel-menu-body .sel-option-icon svg {
  width: 16px;
  height: 16px;
}

/* 名称/描述绝对定位两行：行高必须钉在 1，否则父级行高会让两行叠住。 */
.sel-menu-body .sel-option-copy {
  position: relative;
  display: block;
  flex: 1;
  min-width: 0;
  min-height: 32px;
  align-self: stretch;
  overflow: hidden;
}

.sel-menu-body .sel-option-label {
  position: absolute;
  top: 50%;
  left: 0;
  max-width: 100%;
  overflow: hidden;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateY(-50%);
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}

.sel-menu-body .sel-option-description {
  position: absolute;
  left: 0;
  bottom: 3px;
  max-width: 100%;
  overflow: hidden;
  color: var(--ui-ink-dim);
  font-size: 11px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.sel-menu-body .sel-option.hasDescription:hover .sel-option-label,
.sel-menu-body .sel-option.hasDescription:focus-within .sel-option-label {
  top: 3px;
  transform: translateY(0);
}

.sel-menu-body .sel-option.hasDescription:hover .sel-option-description,
.sel-menu-body .sel-option.hasDescription:focus-within .sel-option-description {
  opacity: 1;
  transform: translateY(0);
}

.sel-menu-body .sel-check {
  width: 16px;
  height: 16px;
  color: var(--ui-ink-dim);
}

/* 分组分隔线：相邻选项 group 不同才画一条，与右键菜单的分块一致 */
.sel-menu-body .sel-option.is-group-start {
  margin-top: 11px;
  position: relative;
}

.sel-menu-body .sel-option.is-group-start::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: -6px;
  height: 1px;
  background: var(--ui-line);
}

.sel-menu-body .sel-list::-webkit-scrollbar {
  width: 8px;
}

.sel-menu-body .sel-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb);
}

.sel-menu-body .sel-list::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover);
}

@keyframes sel-item-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .sel-root .sel-trigger,
  .sel-root .sel-arrow,
  .sel-menu-body .sel-option,
  .sel-menu-body .sel-option-label,
  .sel-menu-body .sel-option-description {
    animation: none !important;
    transition: none !important;
  }
}
</style>
