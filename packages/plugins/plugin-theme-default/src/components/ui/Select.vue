<script setup lang="ts">
/**
 * Select —— 通用下拉选择器（复刻自 canvas-core/src/components/Ui/AxSelect.vue 的单选核心路径）。
 *
 * 职责：把「选项下拉」做成 Dropdown 触发器 + 浮层选项列表，替代原生 <select>。
 * 支持：v-model(string|number)、options(含 disabled)、placeholder、searchable、键盘上下选择/Enter/Esc。
 *
 * 与老版差异：不依赖 Tailwind / material-symbols / @floating-ui，
 * 视觉改用仓库 UI 规范（灰阶填充、青色强调、内联 SVG、宽松选项节奏）。
 * 动画：与 Dropdown 同步，0.12s ease-out。
 *
 * 用法：
 *   <Select v-model="v" :options="[{value:'lr',label:'左→右'},…]" placeholder="请选择" searchable />
 */
import { computed, nextTick, ref, watch } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'
import Dropdown from './Dropdown.vue'
import type { SelectOption } from './types'

/** 图标形态：html=svg 字符串（v-html）/ component=Vue 组件 / none=无 */
function iconMode(icon: unknown): 'html' | 'component' | 'none' {
  return iconRenderMode(icon)
}

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
    /**
     * 浮层**最小宽度**（只在 dropdownWidth:'match' 时生效；缺省 200px）。
     *
     * 为什么要有它：底栏的模型下拉用 dropdownWidth:'match'（与触发框同宽），
     * 而触发框只有 ~100px，于是浮层被挤成一条窄缝、模型名全被截断（用户实测反馈
     * 「下拉的宽度也太窄了吧…至少得两百px」）。给一个最小宽度，窄触发器也能长出
     * 一个看得清选项的面板（min-width 会盖过 match 给的 width）。
     * 'auto' 仍按内容自适应（设置面板里的短选项不该被强行撑到 200px）。
     */
    dropdownMinWidth?: string
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
    inputId: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  change: [value: string | number]
}>()

const open = ref(false)
const searchQuery = ref('')
const highlightIndex = ref(-1)
const searchInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(() => {
  if (props.modelValue === '' || props.modelValue === undefined || props.modelValue === null) return ''
  const opt = props.options.find((o) => o.value === props.modelValue)
  return opt ? opt.label : String(props.modelValue)
})

const filteredOptions = computed(() => {
  if (!searchQuery.value.trim()) return props.options
  const q = searchQuery.value.toLowerCase()
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

function selectOption(opt: SelectOption): void {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  emit('change', opt.value)
  closeDropdown()
}

function closeDropdown(): void {
  open.value = false
  searchQuery.value = ''
  highlightIndex.value = -1
}

function openDropdown(): void {
  open.value = true
  nextTick(() => {
    if (props.searchable && searchInputRef.value) searchInputRef.value.focus()
  })
}

// ---- 键盘 ----
function scrollToHighlight(): void {
  nextTick(() => {
    const items = listRef.value?.querySelectorAll<HTMLElement>('[data-option]')
    const el = items?.[highlightIndex.value]
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeydown(e: KeyboardEvent): void {
  const len = filteredOptions.value.length
  if (len === 0) return
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightIndex.value = highlightIndex.value < len - 1 ? highlightIndex.value + 1 : 0
      scrollToHighlight()
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightIndex.value = highlightIndex.value > 0 ? highlightIndex.value - 1 : len - 1
      scrollToHighlight()
      break
    case 'Enter': {
      e.preventDefault()
      const opt = filteredOptions.value[highlightIndex.value]
      if (opt && highlightIndex.value >= 0) selectOption(opt)
      break
    }
    case 'Escape':
      e.preventDefault()
      closeDropdown()
      break
  }
}

watch(open, (v) => {
  if (!v) {
    searchQuery.value = ''
    highlightIndex.value = -1
  } else {
    // 打开后把高亮定位到当前选中项
    const idx = filteredOptions.value.findIndex((o) => o.value === props.modelValue)
    highlightIndex.value = idx >= 0 ? idx : 0
  }
})

const dropdownMenuWidth = computed(() =>
  props.dropdownWidth === 'match' ? props.dropdownMinWidth : props.dropdownWidth === 'auto' ? '' : props.dropdownWidth,
)
</script>

<template>
  <Dropdown
    v-model="open"
    :placement="placement"
    :offset="4"
    :match-width="dropdownWidth === 'match'"
    :menu-width="dropdownMenuWidth"
    :menu-max-width="dropdownMaxWidth"
    body-class="sel-menu-body"
    menu-role="listbox"
  >
    <!-- 触发器（内部相对容器，撑满父级宽度） -->
    <template #trigger="{ open: isOpen }">
      <div class="sel-trigger-wrap">
        <button
          :id="inputId"
          type="button"
          class="sel-trigger"
          :class="{ 'is-open': isOpen }"
          :aria-haspopup="'listbox'"
          :aria-expanded="isOpen"
          @click.stop="isOpen ? closeDropdown() : openDropdown()"
        >
          <!-- 搜索模式：打开时是输入框 -->
          <template v-if="searchable && isOpen">
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="sel-search"
              :placeholder="searchPlaceholder"
              autocomplete="off"
              @keydown="handleKeydown"
              @click.stop
            />
          </template>
          <template v-else>
            <span class="sel-label" :class="{ 'is-placeholder': selectedLabel === '' }">
              {{ selectedLabel || placeholder }}
            </span>
          </template>
          <span class="sel-arrow" :class="{ 'is-open': isOpen }" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
      </div>
    </template>

    <!-- 选项列表 -->
    <template #default="{ close }">
      <div ref="listRef" class="sel-list" role="listbox" @keydown="handleKeydown">
        <button
          v-for="(opt, index) in filteredOptions"
          :key="opt.value"
          type="button"
          data-option
          role="option"
          :aria-selected="modelValue === opt.value"
          class="sel-option"
          :class="{
            'is-active': modelValue === opt.value,
            'is-highlight': !(modelValue === opt.value) && highlightIndex === index,
            'is-disabled': opt.disabled,
            hasDescription: !!opt.description,
          }"
          @click="selectOption(opt)"
          @mouseenter="highlightIndex = index"
        >
          <!-- 图标托（照右键菜单 / 主题菜单的 look）：有 icon 才渲染 -->
          <span v-if="opt.icon" class="sel-option-icon" aria-hidden="true">
            <span v-if="iconMode(opt.icon) === 'html'" class="sel-option-icon-raw" v-html="opt.icon" />
            <component v-else-if="iconMode(opt.icon) === 'component'" :is="opt.icon" class="sel-option-icon-raw" />
          </span>
          <!-- 名称 + hover 描述：照右键菜单（ContextMenu 的 .ctx-menu-copy）——
               悬停/聚焦时名称上移、描述从下方浮现（用户明确说喜欢这个动效）。 -->
          <span class="sel-option-copy">
            <span class="sel-option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="sel-option-description">{{ opt.description }}</span>
          </span>
          <span v-if="modelValue === opt.value" class="sel-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
              stroke-linejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </button>
        <div v-if="filteredOptions.length === 0" class="sel-empty" role="status">无匹配选项</div>
      </div>
    </template>
  </Dropdown>
</template>

<style scoped>
/* ===== 触发器 ===== */
.sel-trigger-wrap {
  display: block;
  width: 100%;
}

.sel-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--sf-input-line, rgba(0, 0, 0, 0.08));
  border-radius: 8px;
  background: var(--sf-input-bg, rgba(0, 0, 0, 0.03));
  color: var(--sf-label, #111827);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
  /* 短而直接的过渡，避免"明显跳一下" */
  transition: border-color 0.12s ease-out, background 0.12s ease-out, box-shadow 0.12s ease-out;
}

.sel-trigger:hover:not(.is-open) {
  background: var(--sf-input-bg-hover, rgba(0, 0, 0, 0.05));
}

.sel-trigger.is-open {
  border-color: var(--ui-accent, #0891b2);
  background: var(--sf-input-bg-focus, #fff);
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgba(8, 145, 178, 0.14));
}

.sel-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}

.sel-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--sf-label, #111827);
}

.sel-label.is-placeholder {
  color: var(--sf-desc, #9ca3af);
  font-weight: 400;
}

.sel-arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--sf-desc, #6b7280);
  transition: transform 0.12s ease-out, color 0.12s ease-out;
}

.sel-arrow svg {
  width: 14px;
  height: 14px;
}

.sel-arrow.is-open {
  transform: rotate(180deg);
  color: var(--ui-accent, #0891b2);
}

.sel-search {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--sf-label, #111827);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
}

.sel-search::placeholder {
  color: var(--sf-desc, #9ca3af);
  font-weight: 400;
}

/* ===== 浮层（经 Teleport 到 body，Dropdown 提供底色/圆角/阴影）===== */
.sel-menu-body {
  padding: 4px;
}

.sel-list {
  min-width: 120px;
}

/* 选项节奏：上下 padding 8px + 选项之间 gap 2px，浮层 4px padding 共同形成清晰分块 */
.sel-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  box-sizing: border-box;
  margin-top: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dd-ink, #374151);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease-out, color 0.1s ease-out;
}

/* 图标托（照右键菜单）：28×28、圆角 8、淡底、次要前景色 */
.sel-option-icon {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
}
.sel-option-icon-raw {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sel-option-icon :deep(svg),
.sel-option-icon svg {
  width: 16px;
  height: 16px;
}
/* 有图标时该行至少 44px 高（图标托 28 + 上下 padding），与右键菜单同节奏 */
.sel-option:has(.sel-option-icon) {
  min-height: 44px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.sel-option:first-child {
  margin-top: 0;
}

.sel-option:hover,
.sel-option.is-highlight {
  background: var(--sf-input-bg-hover, rgba(0, 0, 0, 0.05));
}

.sel-option.is-active {
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  color: var(--ui-accent, #0e7490);
  font-weight: 600;
}

.sel-option.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.sel-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: -1px;
}

.sel-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 名称/描述区（照右键菜单 .ctx-menu-copy 的 hover 动效）=====
   label 绝对垂直居中；带描述的行 hover/focus-within 时 label 上移到 top:3px、
   描述从下方 translateY(6px) 淡入。数值与 ContextMenu.vue 逐条对齐。 */
.sel-option-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 32px;
  display: block;
}
.sel-option-copy .sel-option-label {
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  max-width: 100%;
}
.sel-option.hasDescription .sel-option-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}
.sel-option.hasDescription:hover .sel-option-label,
.sel-option.hasDescription:focus-within .sel-option-label {
  top: 3px;
  transform: translateY(0);
}
.sel-option-description {
  position: absolute;
  left: 0;
  bottom: 3px;
  max-width: 100%;
  color: var(--ui-ink-dim, #9ca3af);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
.sel-option.hasDescription:hover .sel-option-description,
.sel-option.hasDescription:focus-within .sel-option-description {
  opacity: 1;
  transform: translateY(0);
}

.sel-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--ui-accent, #0891b2);
}

.sel-check svg {
  width: 14px;
  height: 14px;
}

.sel-empty {
  padding: 14px 8px;
  text-align: center;
  color: var(--sf-desc, #9ca3af);
  font-size: 12px;
}

.sel-list::-webkit-scrollbar {
  width: 8px;
}
.sel-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.12));
}
.sel-list::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.2));
}
</style>
