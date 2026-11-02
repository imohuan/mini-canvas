<script setup lang="ts">
/**
 * 外壳槽的默认按钮（底栏 / 状态条 / 抽屉页签三种档位）。
 *
 * 为什么单独成组件：内置按钮和插件按钮要长得一模一样，
 * 而各自抄一遍 class 必然漂移。宿主把本组件经 SlotComposer 的 sharedProps 下发给插件，
 * 插件只传 title / icon / 点击，不再关心尺寸、圆角、hover、暗色。
 *
 * 提示气泡的 TooltipProvider 由**外层宿主**统一提供（StatusArea / DockArea / LeftDrawer），
 * 本组件只负责「触发 + 气泡」。一颗按钮一个 provider 会重复开 context，
 * 而且同一工具栏里的延迟设置应当一致。
 *
 * 尺寸/配色照 docs/design/ui-style-guide.md §3.3 与现有外壳：
 * - dock   ：32×32 / 圆角 8（底栏图标按钮）
 * - status ：28×28 / 圆角 8（状态条图标按钮）
 * - tab    ：28 高 / 圆角 10 / 13px（抽屉页签）
 */
import { computed, type Component } from 'vue'
// 外壳默认按钮统一用 shadcn 原始 Button；尺寸档位仍由下面的 TONE 覆盖住。
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@mini-canvas/ui-kit-shadcn'

const props = withDefaults(
  defineProps<{
    /** icon = 纯图标按钮；text = 带文案的按钮（tab 档专用） */
    variant?: 'icon' | 'text'
    /** 'dock' 32×32 / 'status' 28×28 / 'tab' 页面签 28 高 */
    tone?: 'dock' | 'status' | 'tab'
    /** 无障碍名称 + 悬停说明 */
    title: string
    /** 单独的无障碍名称（缺省 = title） */
    ariaLabel?: string
    /** 图标句柄：SVG 字符串或 Vue 组件 */
    icon?: unknown
    /** 开关类按钮的当前状态（不传就不当开关） */
    active?: boolean
    disabled?: boolean
  }>(),
  {
    variant: 'icon',
    tone: 'dock',
    ariaLabel: undefined,
    icon: undefined,
    active: undefined,
    disabled: false,
  },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

const label = computed(() => props.ariaLabel || props.title)
const isText = computed(() => props.variant === 'text')
// 图标档用固定方形；文字档 / tab 档用 sm，宽度随文字与 TONE 的 px-3 走（tab 不能锁成 32px）。
const buttonSize = computed(() => (isText.value || props.tone === 'tab' ? 'sm' : 'icon-sm'))
const iconHtml = computed(() => (typeof props.icon === 'string' ? props.icon : ''))
const iconComp = computed<Component | null>(() =>
  props.icon && typeof props.icon !== 'string' ? (props.icon as Component) : null,
)

/**
 * `active` 透传：用 `:aria-pressed` 与可见高亮表达开关态。
 * 不给时保留 undefined（普通按钮不被读屏当成开关）。
 */
const pressed = computed<string | undefined>(() =>
  props.active === undefined ? undefined : props.active ? 'true' : 'false',
)

const TONE = {
  dock: 'size-8 min-w-8 rounded-lg',
  status: 'size-7 min-w-7 rounded-lg',
  tab: 'h-7 rounded-[10px] px-3 text-[13px]',
} as const

// shadcn 会把未声明尺寸的 svg 压成 16px：插件传进来的是 24×24 的字符串图标，
// 这里显式给 16px，保证「外壳默认按钮」和插件自绘时代一样大。
const ICON_CLASS = {
  dock: 'size-4',
  status: 'size-3.5',
  tab: 'size-4',
} as const
</script>

<template>
  <!-- 提示用 shadcn Tooltip：内置按钮那种主题气泡；不再用浏览器原生 title 的小黑框。 -->
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        variant="ghost"
        :size="buttonSize"
        class="inline-flex flex-none items-center justify-center gap-1 text-ink disabled:cursor-not-allowed disabled:opacity-40"
        :class="[
          TONE[props.tone],
          isText ? 'font-medium' : '',
          props.active ? 'bg-hover-strong' : '',
        ]"
        type="button"
        :aria-label="label"
        :aria-pressed="pressed"
        :disabled="disabled"
        @click="emit('click', $event)"
      >
        <span v-if="iconHtml" class="inline-flex shrink-0" :class="ICON_CLASS[props.tone]" aria-hidden="true" v-html="iconHtml" />
        <component :is="iconComp" v-else-if="iconComp" class="shrink-0" :class="ICON_CLASS[props.tone]" aria-hidden="true" />
        <span v-if="$slots.default"><slot /></span>
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top" :side-offset="8">{{ title }}</TooltipContent>
  </Tooltip>
</template>
