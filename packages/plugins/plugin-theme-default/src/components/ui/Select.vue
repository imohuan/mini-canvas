<script setup lang="ts">
/**
 * Select —— 通用下拉选择器（复刻自 canvas-core/src/components/Ui/AxSelect.vue 的单选核心路径）。
 *
 * 职责：把「选项下拉」做成 Dropdown 触发器 + 浮层选项列表，替代原生 <select>。
 * 支持：v-model(string|number)、options(含 disabled)、placeholder、searchable、键盘上下选择/Enter/Esc。
 *
 * 与老版差异：不依赖 Tailwind / material-symbols / @floating-ui，
 * 视觉改用仓库 UI 规范（灰阶填充、内联 SVG）。
 *
 * 下拉容器走**注册场里登记的那一份**（见 useCatalogDropdown）：成品应用顶替了 dropdown
 * 就会用那一份，只装主题包时回落本包自带的 Dropdown.vue（用户口径 2026-10-12）。
 *
 * 用法：
 *   <Select v-model="v" :options="[{value:'lr',label:'左→右'},…]" placeholder="请选择" searchable />
 */
import { computed, nextTick, ref, watch } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'
import { useCatalogDropdown } from './useCatalogDropdown'
import type { SelectOption } from './types'

/** 下拉容器：优先用注册场登记的那一份，取不到才回落本包自带 */
const Dropdown = useCatalogDropdown()

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

/**
 * 某一行**前面**要不要画一条分隔线：相邻选项的 group 不同就画（与右键菜单的分块同款）。
 *
 * 没声明 group 的选项归一为空串 —— 于是「有分组的模型」下面接「没有分组的旋转/下载」也会
 * 分出一条线（右键菜单里不同类型之间就是这样分开的，用户要求「完全参考」）。
 * 整个列表都没声明 group 时两边都是空串、一条线都不画，与改造前逐像素一致。
 */
function groupBreakAt(index: number): boolean {
  const list = filteredOptions.value
  if (index <= 0) return false
  return (list[index - 1]?.group ?? '') !== (list[index]?.group ?? '')
}
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
          :style="{ '--item-index': index }"
          :class="{
            'is-active': modelValue === opt.value,
            'is-highlight': !(modelValue === opt.value) && highlightIndex === index,
            'is-disabled': opt.disabled,
            hasDescription: !!opt.description,
            'is-group-start': groupBreakAt(index),
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

.sel-list {
  min-width: 120px;
}

/* 行：数值照 .ctx-menu-item（44 高 / 6px 内边距 / 10 行内间距 / 10 圆角）。
   行与行之间**不留空隙**（右键菜单也是紧挨着的），分块感由内边距给。 */
.sel-option {
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
  color: var(--dd-ink, #374151);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  /* 入场：逐项上滑淡入，按索引交错（照右键菜单 .ctx-menu-item） */
  animation: sel-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
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
.sel-option:hover,
.sel-option.is-highlight {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
}

/* 分组分隔线（照右键菜单 .ctx-menu-divider 的数值：1px、上下 5px）。
   相邻选项的 group 不同才画（见 groupBreakAt）；整个列表都没分组时一条都不画。 */
.sel-option.is-group-start {
  margin-top: 11px;
  position: relative;
}
.sel-option.is-group-start::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: -6px;
  height: 1px;
  background: var(--ui-line, rgba(0, 0, 0, 0.06));
}

/* 当前项：**灰阶**（用户口径 2026-10-12：「这里其实不需要使用主题颜色……就和你的右键菜单一样」）。
   右键菜单整张卡没有一处强调色；这里同样不铺底色 —— 靠**字重 + 右侧那枚 ✓** 说明「就是它」，
   而底色只表示"鼠标/键盘停在这一行"。两者分开，键盘上下选时才不会分不清 Enter 会选中哪一行。 */
.sel-option.is-active {
  color: var(--ui-ink, #111827);
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
  /* 行高必须钉在 1：本元素是 .sel-option-copy 的绝对定位子元素，
     行高若走继承（宿主给了 1.6 → 13px 正文 = 20.8px 行盒），hover 时"名称上移 +
     描述浮出"这两行就会互相压住（实测：名称下缘 521 压到描述上缘 519，重合 2px）。
     右键菜单那本（.ctx-menu-label）本来就写着 line-height: 1，这里补齐同一档。 */
  line-height: 1;
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
  /* 勾也走灰阶（与右键菜单同口径：整张菜单不用主题色） */
  color: var(--ui-ink-dim, #6b7280);
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

/* 逐项入场（与右键菜单 .ctx-menu-item 的同名动画逐条对齐） */
@keyframes sel-item-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sel-trigger,
  .sel-arrow,
  .sel-option,
  .sel-option-label,
  .sel-option-description {
    animation: none !important;
    transition: none !important;
  }
}
</style>

<style>
/* 浮层外观（经 Teleport 到 body，必须用全局样式）。
   数值照右键菜单 .ctx-menu 逐条对齐（用户要求「下拉完全参考右键菜单」）：
   16 圆角、6px 内边距、**不透明白底**（--ui-overlay-solid，与节点控制栏同一档 ——
   菜单压在画布节点/图片上，半透明会让底下的内容透出来、字读不清）。

   这里只给变量：浮层元素是 Dropdown 渲染的（带它的 scope id），本组件的 scoped 规则
   命不中它；而 Dropdown 那条 .dd-menu 规则是 scoped、特异性更高，直接写 padding /
   border-radius 也盖不住。变量不参与特异性比较，交给那边消费。 */
.sel-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid, #fff);
}
</style>
