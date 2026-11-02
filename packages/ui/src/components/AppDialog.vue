<script setup lang="ts">
/**
 * AppDialog —— 应用内的通用弹窗，底座是组件库的 shadcn Dialog。
 *
 * 取代旧的 AxDialog。为什么保留这一层（而不是各处直接写 Dialog）：
 * 应用里有三处弹窗需要**同一套窗口级行为** —— 遮罩 / Esc / 点外关闭 / 焦点归还 /
 * 无遮罩（withOverlay=false 的生成历史）/ 自定义宽高与圆角。逐个手写一遍必然漂移，
 * 所以这里只做"把旧 props 映射到 shadcn Dialog"这一件事，不留任何自绘外观。
 *
 * 行为对照（旧 AxDialog → 这里）：
 * - Esc / 点遮罩关闭 → DialogContent 的 @pointer-down-outside + Escape
 * - 焦点归还 / 焦点陷阱 / 滚动锁定 → reka-ui Dialog 原生提供（旧实现是手写的）
 * - withOverlay=false → 用透明遮罩（仍然保留“点外面 / Esc 不关”的模态行为，但完全不挡画面）
 * - 点击遮罩后把 click 还给底层按钮（旧实现 lastActive）→ reka-ui 默认不会抢走该点击
 */
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogOverlay,
} from '@mini-canvas/ui-kit-shadcn'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 面板宽度（px 或 CSS 值） */
    width?: string
    height?: string
    maxWidth?: string
    maxHeight?: string
    closeOnOverlay?: boolean
    /** 是否画遮罩（生成历史这类大面板不要深遮罩） */
    withOverlay?: boolean
    radius?: string
    panelClass?: HTMLAttributes['class']
    overlayClass?: HTMLAttributes['class']
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

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const panelStyle = computed(() => ({
  width: props.width || undefined,
  height: props.height || undefined,
  maxWidth: props.maxWidth || undefined,
  maxHeight: props.maxHeight || undefined,
  borderRadius: props.radius || undefined,
}))

function onOpenChange(value: boolean): void {
  open.value = value
}

function onPointerDownOutside(e: Event): void {
  if (!props.closeOnOverlay) e.preventDefault()
}

function onEscapeKeyDown(e: KeyboardEvent): void {
  if (!props.closeOnOverlay) e.preventDefault()
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <!--
      遮罩必须是 DialogContent 的**兄弟**，不能写进它的默认插槽。
      以前 DialogOverlay 被放进 DialogContent 里，它会按 fixed inset-0 铺满
      弹窗内容区域，正好把面板整块盖住 —— 生成历史“点了没反应”就是这个原因
      （2026-11-02 实测：弹窗 DOM 存在，但第一个子元素是 0.35 不透明度的遮罩）。

      这里只保留调用方自定义遮罩样式的入口；默认的 DialogContent 已经自带一层遮罩。
    -->
    <DialogOverlay
      v-if="!withOverlay"
      class="appdlg-overlay is-clear"
      :class="overlayClass"
    />
    <DialogOverlay v-else-if="overlayClass" class="appdlg-overlay" :class="overlayClass" />
    <DialogContent
      class="appdlg-panel"
      :class="panelClass"
      :style="panelStyle"
      :show-close-button="false"
      @pointer-down-outside="onPointerDownOutside"
      @escape-key-down="onEscapeKeyDown"
    >
      <slot :close="() => (open = false)" />
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/*
 * 只补项目外壳的两件事：深色遮罩 + 面板底色/边框/阴影。
 * 其余（居中、动画、焦点、滚动锁）都在 shadcn Dialog 里。
 */
.appdlg-overlay {
  background: var(--ui-scrim, rgb(0 0 0 / 0.5));
}

/* 无遮罩形态（生成历史）：仍是模态，但画面完全透出来 */
.appdlg-overlay.is-clear {
  background: transparent;
  backdrop-filter: none;
}

:deep(.appdlg-panel) {
  background: var(--ui-panel, #1f1f1f);
  border: 1px solid var(--ui-line, rgb(255 255 255 / 0.08));
  color: var(--ui-ink, #f7f7f7);
  box-shadow: var(--ui-shadow-lg, 0 24px 60px rgb(0 0 0 / 0.45));
}
</style>

