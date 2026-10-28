<script setup lang="ts">
/**
 * 外壳槽的默认按钮（底栏 / 状态条 / 抽屉页签三种档位）。
 *
 * 为什么单独成组件：内置按钮和插件按钮要长得一模一样，
 * 而各自抄一遍 class 必然漂移。宿主把本组件经 SlotComposer 的 sharedProps 下发给插件，
 * 插件只传 title / icon / 点击，不再关心尺寸、圆角、hover、暗色。
 *
 * 尺寸/配色照 docs/design/ui-style-guide.md §3.3 与现有外壳：
 * - dock   ：32×32 / 圆角 8（底栏图标按钮）
 * - status ：28×28 / 圆角 8（状态条图标按钮）
 * - tab    ：28 高 / 圆角 10 / 13px（抽屉页签）
 */
import { computed, type Component, type PropType } from 'vue'
import AxTooltip from '../AxTooltip.vue'

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
const iconHtml = computed(() => (typeof props.icon === 'string' ? props.icon : ''))
const iconComp = computed<Component | null>(() =>
  props.icon && typeof props.icon !== 'string' ? (props.icon as Component) : null,
)

const TONE = {
  dock: 'size-8 rounded-lg',
  status: 'size-7 rounded-lg',
  tab: 'h-7 rounded-[10px] px-3 text-[13px]',
} as const
</script>

<template>
  <!-- 提示用 AxTooltip：内置按钮那种主题气泡；不再用浏览器原生 title 的小黑框。 -->
  <AxTooltip :content="title" placement="top" trigger-class="flex-none">
    <button
      class="inline-flex flex-none items-center justify-center gap-1 text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
      :class="[
        TONE[props.tone],
        isText ? 'font-medium' : '',
        props.active ? 'bg-hover-strong' : '',
      ]"
      type="button"
      :aria-label="label"
      :aria-pressed="active === undefined ? undefined : active ? 'true' : 'false'"
      :disabled="disabled"
      @click="emit('click', $event)"
    >
      <span v-if="iconHtml" class="inline-flex" aria-hidden="true" v-html="iconHtml" />
      <component :is="iconComp" v-else-if="iconComp" aria-hidden="true" />
      <span v-if="$slots.default"><slot /></span>
    </button>
  </AxTooltip>
</template>
