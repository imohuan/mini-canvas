<script setup lang="ts">
// AxDialog —— 通用弹窗。遮罩 + 居中面板 + Esc 关闭 + 点遮罩关闭。
// 思路照 web2api 的 AxDialog（focus 归还 / body overflow 锁定），
// 外观用画布 token（面板 #242424 / 边框 rgba(255,255,255,.08)）。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 面板宽度（px 或 CSS 值） */
    width?: string
    height?: string
    maxWidth?: string
    maxHeight?: string
    closeOnOverlay?: boolean
    /** 点遮罩是否关闭（默认 true，但目标页的部分面板无遮罩） */
    withOverlay?: boolean
    radius?: string
    panelClass?: string
    /** 遮罩层额外 class（例如想要更浅/更深的遮罩时用） */
    overlayClass?: string
  }>(),
  {
    modelValue: false,
    width: '',
    height: '',
    maxWidth: 'calc(100vw - 48px)',
    maxHeight: 'calc(100vh - 48px)',
    closeOnOverlay: true,
    withOverlay: true,
    radius: '24px',
    panelClass: '',
    overlayClass: '',
  },
)

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const panelRef = ref<HTMLElement | null>(null)
/** 点击遮罩时透过来的目标元素：overlay 关闭后把 click 还给它（用于"点 dock 按钮关弹窗并触发按钮"） */
let lastActive: HTMLElement | null = null

function close(): void {
  emit('update:modelValue', false)
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.modelValue) close()
  /**
   * Tab 在面板内循环（ui-style-guide §5 第 6 条「模态三要素」里的焦点管理）。
   *
   * 为什么必须做：全壳的 Tab 已被 App.vue 接管成「只在这个浮层里循环」（见 tabPageOnly.ts）。
   * 落到哪一层由**离焦点最近**的那个处理器说了算 —— 本组件是模态（aria-modal="true"），
   * 关掉它的时候 focus 已经还给了打开它的按钮，这时候按 Tab 没人拦就会一路跑到 body，
   * 于是「弹出框最底下那几个按钮」（用户口径里的例外）反而 Tab 不到了。
   *
   * 刻意**不**做焦点陷阱的另外半边（Tab 不许离开面板）：全局那条规则已经保证这一点，
   * 这里再拦一次是为了让光标在面板内**循环**（到末尾回到第一个），符合模态的使用习惯。
   */
  if (e.key === 'Tab' && props.modelValue && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const items = panelRef.value?.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    )
    if (items?.length) {
      const list = Array.from(items).filter((el) => {
        const el2 = el as HTMLInputElement
        if (el2.disabled) return false
        const idx = el.getAttribute('tabindex')
        return !(idx !== null && Number(idx) < 0)
      })
      const i = list.indexOf(document.activeElement as HTMLElement)
      if (list.length) {
        e.preventDefault()
        const next = e.shiftKey
          ? list[i <= 0 ? list.length - 1 : i - 1]
          : list[i < 0 || i === list.length - 1 ? 0 : i + 1]
        next?.focus()
      }
    }
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      lastActive = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      nextTick(() => panelRef.value?.querySelector<HTMLElement>('button,input,a,[tabindex]')?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown)
      lastActive?.focus?.()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="axdlg">
      <!-- root 也接管「点面板外区域关闭」：with-overlay=false 的弹窗（如生成历史）没有遮罩元素，
           点四周留白同样应该能关掉。有遮罩时点到的会是 overlay（target 不是 root），仍由 overlay 处理。 -->
      <div v-if="modelValue" class="axdlg-root" @pointerdown.self="closeOnOverlay && close()">
        <div v-if="withOverlay" class="axdlg-overlay" :class="overlayClass" @pointerdown.self="closeOnOverlay && close()" />
        <div
          ref="panelRef"
          class="axdlg-panel"
          :class="panelClass"
          :style="{ width: width || undefined, height: height || undefined, maxWidth, maxHeight, borderRadius: radius }"
          role="dialog"
          aria-modal="true"
        >
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
/* 非 scoped：面板被 Teleport 到 body，必须用全局主题变量才能跟随亮/暗切换 */
.axdlg-root { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; }
.axdlg-overlay { position: absolute; inset: 0; background: var(--ui-scrim); }
/* 浅遮罩：大面板（生成历史）用，既能一眼看出"点外面可关"，又不太压暗底层 */
.axdlg-overlay--soft { background: var(--ui-scrim-soft); }
.axdlg-panel { position: relative; z-index: 1; display: flex; flex-direction: column; overflow: hidden; color: var(--ui-ink); border: 1px solid var(--ui-line); background: var(--ui-panel); box-shadow: var(--ui-shadow-lg); }
.axdlg-enter-active, .axdlg-leave-active { transition: opacity .18s ease-out; }
.axdlg-enter-active .axdlg-panel, .axdlg-leave-active .axdlg-panel { transition: transform .18s cubic-bezier(.4, 0, .2, 1); }
.axdlg-enter-from, .axdlg-leave-to { opacity: 0; }
.axdlg-enter-from .axdlg-panel, .axdlg-leave-to .axdlg-panel { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) {
  .axdlg-enter-active, .axdlg-leave-active,
  .axdlg-enter-active .axdlg-panel, .axdlg-leave-active .axdlg-panel { transition: none; }
}
</style>
