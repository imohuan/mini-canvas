<script setup lang="ts">
/**
 * Dropdown —— 通用下拉浮层（复刻自 canvas-core/src/components/Ui/AxDropdown.vue）。
 *
 * 用途：任何「触发器 + 浮层菜单」组合：右键菜单 / 选择器 / 弹出面板。
 * 与老版差异：不依赖 Tailwind / @vueuse / @floating-ui，改用本包自己的
 * 浮层定位 + click-outside + 项目统一 UI token（灰阶 + 青色强调 + 内联 SVG）。
 * 动画：入场/关闭 0.12s ease-out（短而直接，不带回弹，避免"跳一下"的观感）。
 *
 * 用法：
 *   <Dropdown v-model="open" placement="bottom-start" :offset="6" :match-width="true">
 *     <template #trigger="{ open, toggle }">…</template>
 *     <template #default="{ close }">…菜单项…</template>
 *   </Dropdown>
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** 触发方式：click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    /** hover 模式下鼠标离开触发器后延迟关闭的时间 (ms) */
    hoverCloseDelay?: number
    menuWidth?: string
    menuMaxWidth?: string
    /** 内容区扩展样式，替换默认内边距 */
    bodyClass?: string
    teleport?: boolean
    /** 浮层最大高度，超出滚动 */
    menuMaxHeight?: string
    /** 浮层 role（默认 menu；选项列表用 listbox） */
    menuRole?: string
  }>(),
  {
    modelValue: false,
    placement: 'bottom-start',
    offset: 6,
    matchWidth: false,
    trigger: 'click',
    hoverCloseDelay: 150,
    menuWidth: '',
    menuMaxWidth: '',
    bodyClass: '',
    teleport: true,
    menuMaxHeight: '',
    menuRole: 'menu',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null)

// 内部状态：支持无 v-model 用法（uncontrolled 模式）
const isOpen = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    isOpen.value = v
  },
)

// ---- 浮动定位：fixed + left/top，简单翻转防溢出（不引 floating-ui）----
const pos = ref<{ left: number; top: number; width?: number }>({ left: -9999, top: -9999 })
function computePosition(): void {
  const trig = triggerRef.value
  const menu = menuRef.value
  if (!trig || !menu) return
  const tr = trig.getBoundingClientRect()
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  const gap = props.offset
  let left = tr.left
  let top = tr.bottom + gap
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 水平：bottom-start（默认）靠左对齐；end 靠右对齐；top-* 系列同理
  const p = props.placement
  if (p === 'bottom-end' || p === 'top-end') left = tr.right - mw
  if (p === 'bottom' || p === 'top') left = tr.left + (tr.width - mw) / 2
  if (p.startsWith('top')) top = tr.top - mh - gap

  // 翻转：下方放不下翻到上方
  if (p.startsWith('bottom') && top + mh > vh - 8 && tr.top - mh - gap > 8) {
    top = tr.top - mh - gap
  }
  // 左右越界收进视口
  if (left + mw > vw - 8) left = Math.max(8, vw - mw - 8)
  if (left < 8) left = 8

  const out: { left: number; top: number; width?: number } = { left, top }
  if (props.matchWidth) out.width = tr.width
  pos.value = out
}

function open(): void {
  clearCloseTimer()
  isOpen.value = true
  emit('update:modelValue', true)
  nextTick(() => computePosition())
}
function close(): void {
  clearCloseTimer()
  isOpen.value = false
  emit('update:modelValue', false)
}
function toggle(): void {
  isOpen.value = !isOpen.value
  emit('update:modelValue', isOpen.value)
  if (isOpen.value) nextTick(() => computePosition())
}

const clearCloseTimer = (): void => {
  if (closeTimer.value) {
    clearTimeout(closeTimer.value)
    closeTimer.value = null
  }
}
const scheduleClose = (): void => {
  clearCloseTimer()
  closeTimer.value = setTimeout(close, props.hoverCloseDelay)
}

// ---- 触发事件 ----
const triggerEvents = computed(() => {
  switch (props.trigger) {
    case 'hover':
      return { onMouseenter: open, onMouseleave: scheduleClose }
    case 'contextmenu':
      return {
        onContextmenu: (e: MouseEvent) => {
          e.preventDefault()
          open()
        },
      }
    case 'click':
    default:
      // click 触发器：单击 = 打开（关闭由 click-outside / Esc 接管）。
      // 消费方需要自管 toggle 的（如 Select 想点 trigger 切换开/关），
      // 必须在内部按钮上 @click.stop 阻止事件冒泡到这里，避免外层"重新打开"造成闪一下。
      return { onClick: open }
  }
})

// hover 模式下，鼠标移入面板取消关闭倒计时，移出则关闭
const panelEvents = computed(() => {
  if (props.trigger !== 'hover') return {}
  return { onMouseenter: clearCloseTimer, onMouseleave: close }
})

// ---- 点击外部关闭 ----
function onDocPointerDown(e: PointerEvent): void {
  const target = e.target as Node
  if (containerRef.value?.contains(target)) return
  if (menuRef.value?.contains(target)) return
  if (isOpen.value) close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) close()
}

watch(isOpen, (v) => {
  if (v) nextTick(() => computePosition())
})

let ro: ResizeObserver | undefined
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (isOpen.value) computePosition()
    })
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  ro?.disconnect()
  clearCloseTimer()
})

watch(isOpen, (v) => {
  if (v && ro && menuRef.value) ro.observe(menuRef.value)
  else if (!v && ro) ro.disconnect()
})
</script>

<template>
  <div ref="containerRef" class="dd">
    <div ref="triggerRef" class="dd-trigger" v-bind="triggerEvents">
      <slot name="trigger" :open="isOpen" :toggle="toggle" :close="close" />
    </div>

    <Teleport to="body" :disabled="!teleport">
      <!-- 直接显示 / 隐藏，无动画；保留 v-if 触发 enter/leave class 以便未来按需接入。 -->
      <div
        v-if="isOpen"
        ref="menuRef"
        class="dd-menu"
        :class="bodyClass"
        :style="{
          left: pos.left + 'px',
          top: pos.top + 'px',
          minWidth: props.menuWidth || undefined,
          maxWidth: props.menuMaxWidth || undefined,
          maxHeight: props.menuMaxHeight || undefined,
        }"
        v-bind="panelEvents"
        :role="menuRole"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
  text-align: left;
}

.dd-trigger {
  display: block;
}

/* 浮层本体：直接显示 / 隐藏，不做入场/退场动画。 */
.dd-menu {
  position: fixed;
  z-index: 100000;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  color: #374151;
  overflow-y: auto;
  scrollbar-width: thin;
  font-size: 13px;
}
</style>
