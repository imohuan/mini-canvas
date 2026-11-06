<script setup lang="ts">
/**
 * FeedbackHost —— 全应用唯一的确认 / 输入 / 告知宿主。
 *
 * 取代各页面自己调 window.confirm / prompt / alert（用户口径 2026-11-06：全局禁止浏览器默认弹窗）。
 * 组件全部取自 ui 目录，所以换主题时它跟按钮、下拉一起换；这里不 import 组件库。
 *
 * 两种外观各管一件事：
 * - confirm / alert 用 shadcn AlertDialog（页面必须明确回答，点遮罩不消失）；
 * - prompt 用 shadcn Dialog（里面要放输入框与校验错误）。
 *
 * 服务本体在 @mini-canvas/canvas-render 的 feedback.ts：排队、Promise 都在那里，
 * 本组件只负责把 current 画出来并把用户的选择回填 —— 宿主/插件都从 ctx 取同一份服务。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useCanvasContextOrRender, splitDescription, type FeedbackService } from '@mini-canvas/canvas-render'
import { useUiComponent } from '@mini-canvas/canvas-render'

const AlertDialog = useUiComponent('AlertDialog')
const AlertDialogContent = useUiComponent('AlertDialogContent')
const AlertDialogHeader = useUiComponent('AlertDialogHeader')
const AlertDialogTitle = useUiComponent('AlertDialogTitle')
const AlertDialogDescription = useUiComponent('AlertDialogDescription')
const AlertDialogFooter = useUiComponent('AlertDialogFooter')
const AlertDialogCancel = useUiComponent('AlertDialogCancel')
const AlertDialogAction = useUiComponent('AlertDialogAction')

const Dialog = useUiComponent('Dialog')
const DialogContent = useUiComponent('DialogContent')
const DialogHeader = useUiComponent('DialogHeader')
const DialogTitle = useUiComponent('DialogTitle')
const DialogDescription = useUiComponent('DialogDescription')
const DialogFooter = useUiComponent('DialogFooter')
const Button = useUiComponent('Button')
const Input = useUiComponent('Input')

const { ctx } = useCanvasContextOrRender()
const service = ctx.get<FeedbackService>('feedback')

const current = computed(() => service?.current ?? null)
const open = computed({
  get: () => current.value !== null,
  // AlertDialog 的取消 / Esc 都走这里：等同于用户点「取消」
  set: (value: boolean) => {
    if (!value) service?.cancel()
  },
})

/** confirm / alert 的按钮语气：删除类用 destructive */
const destructive = computed(() => current.value?.kind !== 'prompt' && current.value?.tone === 'destructive')
const paragraphs = computed(() => splitDescription(current.value?.description))

/**
 * 面板内边距 / 间距用内联样式写死。
 *
 * 为什么不只靠 shadcn 的 utility class：这套弹窗挂在应用根、由主题按名取件渲染，
 * Tailwind 只扫应用源码、扫不到这里时 p-6 / gap-6 会整条丢失，标题与输入框就挤在一起
 * （2026-11-06 真机截图）。内联样式对扫描结果不敏感，换主题也不会变形。
 */
/** 面板外观（圆角 / 底色 / 阴影）。内边距由里面的 .fb-body 提供：
 *  ui-kit 的 host.css 对 [data-slot='dialog-content'] 强制 padding:0 !important，
 *  面板骨架里再留一层自己的内边距，才能既遵守全局契约又保持可读的间距。 */
const panelStyle = {
  borderRadius: '16px',
  background: 'var(--ui-panel, #fff)',
  color: 'var(--ui-ink, #18202b)',
  boxShadow: 'var(--ui-shadow-lg, 0 24px 60px rgb(0 0 0 / 0.28))',
} as const

const titleStyle = { fontSize: '16px', fontWeight: 700, lineHeight: 1.3 } as const
const bodyStyle = { fontSize: '13px', lineHeight: 1.7, color: 'var(--ui-ink-dim, #6b7280)' } as const
const footerStyle = { marginTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '8px' } as const
/** 危险按钮：实心红底白字（删除类操作）；普通确认用主题主按钮 */
const dangerStyle = {
  background: 'var(--ui-danger, #ef4444)',
  // 实心危险底上的字用主题的 primary-ink（禁止写死 #fff，颜色规范测试会拦）
  color: 'var(--ui-primary-ink, #fff)',
  border: 'none',
} as const

// —— 输入框（prompt）——
const draft = ref('')
const errorText = ref('')
const inputEl = ref<HTMLInputElement | { $el?: HTMLElement } | null>(null)

watch(
  () => current.value,
  (req) => {
    if (!req || req.kind !== 'prompt') return
    draft.value = req.defaultValue
    errorText.value = ''
    void nextTick(() => {
      const el = (inputEl.value as { $el?: HTMLElement } | null)?.$el ?? (inputEl.value as HTMLElement | null)
      el?.focus?.()
      if (el instanceof HTMLInputElement) el.select()
    })
  },
  { immediate: true },
)

function acceptPrompt(): void {
  const req = current.value
  if (!req || req.kind !== 'prompt') return
  const value = draft.value.trim()
  // 输入框语义：允许保留用户原文（名字里的空格有意义），只拒绝全空。
  const why = req.validate?.(value) ?? (value ? '' : '请先输入名字')
  if (why) {
    errorText.value = why
    return
  }
  service?.accept(value)
}

function acceptSimple(): void {
  service?.accept()
}
</script>

<template>
  <AlertDialog v-if="current && current.kind !== 'prompt'" v-model:open="open">
    <AlertDialogContent size="sm" class="max-w-[420px]" :style="panelStyle">
      <div class="fb-body">
      <AlertDialogHeader style="display: flex; flex-direction: column; gap: 8px; text-align: left; place-items: stretch">
        <AlertDialogTitle :style="titleStyle">{{ current.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="paragraphs.length" class="text-ink-dim">
          <p v-for="(p, i) in paragraphs" :key="i" :style="{ ...bodyStyle, marginTop: i > 0 ? '8px' : 0 }">{{ p }}</p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter :style="footerStyle">
        <AlertDialogCancel class="rounded-lg">{{ 'cancelText' in current ? current.cancelText : '取消' }}</AlertDialogCancel>
        <AlertDialogAction
          class="rounded-lg"
          :style="destructive ? dangerStyle : undefined"
          @click="acceptSimple"
        >{{ current.confirmText }}</AlertDialogAction>
      </AlertDialogFooter>
      </div>
    </AlertDialogContent>
  </AlertDialog>

  <Dialog v-else-if="current" :open="open" @update:open="open = $event">
    <DialogContent :show-close-button="false" class="max-w-[440px]" :style="panelStyle" @keydown.enter.prevent="acceptPrompt">
      <div class="fb-body">
      <DialogHeader style="display: flex; flex-direction: column; gap: 8px">
        <DialogTitle :style="titleStyle">{{ current.title }}</DialogTitle>
        <DialogDescription v-if="paragraphs.length" class="text-ink-dim">
          <p v-for="(p, i) in paragraphs" :key="i" :style="{ ...bodyStyle, marginTop: i > 0 ? '8px' : 0 }">{{ p }}</p>
        </DialogDescription>
      </DialogHeader>
      <label style="display: flex; flex-direction: column; gap: 6px">
        <span v-if="current.label" :style="{ ...bodyStyle, fontSize: '12px' }">{{ current.label }}</span>
        <Input
          ref="inputEl"
          v-model="draft"
          :placeholder="current.placeholder"
          :aria-invalid="errorText ? 'true' : undefined"
          :aria-label="current.title"
          style="height: 36px; padding: 0 12px; border: 1px solid var(--ui-line, rgb(0 0 0 / 0.14)); border-radius: 8px; background: var(--ui-veil, rgb(0 0 0 / 0.03)); color: inherit; font-size: 13px; outline: none; width: 100%"
          @update:model-value="errorText = ''"
        />
        <span v-if="errorText" style="font-size: 12px; color: var(--ui-danger, #ef4444)" role="alert">{{ errorText }}</span>
      </label>
      <DialogFooter :style="footerStyle">
        <Button variant="outline" class="rounded-lg" @click="service?.cancel()">{{ current.cancelText }}</Button>
        <Button class="rounded-lg" @click="acceptPrompt">{{ current.confirmText }}</Button>
      </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* 自带内边距：ui-kit 统一把 dialog-content 的外层 padding / gap 清成 0，
   这里在面板内部留 24px，标题、说明、输入框与按钮才不挤在一起。 */
.fb-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
</style>
