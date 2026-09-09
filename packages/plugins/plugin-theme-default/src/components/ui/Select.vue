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
import Dropdown from './Dropdown.vue'

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
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
  props.dropdownWidth === 'match' || props.dropdownWidth === 'auto' ? '' : props.dropdownWidth,
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
          }"
          @click="selectOption(opt)"
          @mouseenter="highlightIndex = index"
        >
          <span class="sel-option-label">{{ opt.label }}</span>
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
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  color: #111827;
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
  background: rgba(0, 0, 0, 0.05);
}

.sel-trigger.is-open {
  border-color: rgba(8, 145, 178, 0.6);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.14);
}

.sel-trigger:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

.sel-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #111827;
}

.sel-label.is-placeholder {
  color: #9ca3af;
  font-weight: 400;
}

.sel-arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #6b7280;
  transition: transform 0.12s ease-out, color 0.12s ease-out;
}

.sel-arrow svg {
  width: 14px;
  height: 14px;
}

.sel-arrow.is-open {
  transform: rotate(180deg);
  color: #0891b2;
}

.sel-search {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #111827;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
}

.sel-search::placeholder {
  color: #9ca3af;
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
  color: #374151;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease-out, color 0.1s ease-out;
}

.sel-option:first-child {
  margin-top: 0;
}

.sel-option:hover,
.sel-option.is-highlight {
  background: rgba(0, 0, 0, 0.05);
}

.sel-option.is-active {
  background: rgba(8, 145, 178, 0.12);
  color: #0e7490;
  font-weight: 600;
}

.sel-option.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.sel-option:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -1px;
}

.sel-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sel-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #0891b2;
}

.sel-check svg {
  width: 14px;
  height: 14px;
}

.sel-empty {
  padding: 14px 8px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.sel-list::-webkit-scrollbar {
  width: 8px;
}
.sel-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.sel-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}
</style>
