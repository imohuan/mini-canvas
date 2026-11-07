<script setup lang="ts">
/**
 * ChoicePickerMenu —— 底栏「生成模型」下拉的**唯一实现**（用户 2026-11-07）。
 *
 * 背景弹窗（新建预设）也要这个下拉；此前两处各自拼装，图标参数一个传错就长成两副样子。
 * 现在触发器 + DropdownMenu + Agent 的卡片/分栏面板全部收进这一个组件：
 * - 底栏（BottomBarChoicePicker）与弹窗（BottomBarPresets）都只传数据，不再自摆 UI；
 * - 图标 / 平台归一交给 Agent 的 ChoicePicker 内部（brandSvg + detectPlatform），
 *   调用方不再传 platform，杜绝「传错一个字段整排图标变通用」的坑。
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ModelIcon } from './modelIcons'

export interface PickerItem {
  id: string
  title: string
  subtitle?: string
  note?: string
  isDefault?: boolean
}

const props = withDefaults(
  defineProps<{
    items: PickerItem[]
    currentId: string
    triggerLabel: string
    triggerIcon?: ModelIcon | null
    /** 触发器 aria / title（底栏「选择生成模型」，弹窗「适用模型」） */
    triggerTitle?: string
    title?: string
    railLabel?: string
    placeholder?: string
    emptyText?: string
    disabled?: boolean
    /** 弹窗里用：面板固定尺寸、向下开；底栏分栏时向上开 */
    inDialog?: boolean
  }>(),
  {
    triggerTitle: '选择生成模型',
    title: '生成模型',
    railLabel: '平台',
    placeholder: '搜索模型或平台',
    emptyText: '没有匹配的模型',
    disabled: false,
    inDialog: false,
  },
)

const emit = defineEmits<{
  pick: [id: string]
  unavailable: []
}>()

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const AgentChoicePicker = useUiComponent('agentChoicePicker')

const open = ref(false)
const available = computed(() => Boolean(AgentChoicePicker.value))

/**
 * 菜单关闭时把视图状态重置回卡片。
 *
 * 为什么必须：面板（AgentChoicePicker）每次打开都重新挂载、内部 view 从 card 开始；
 * 而这里的 splitView 是外层 ref，关闭后仍保留旧值。不重置的话「上次切到分栏 → 关闭
 * → 再打开」就会出现：面板是卡片视图、浮层却按分栏的 588px 打开 —— 页签与内容错位
 * （用户 2026-11-07 连续反馈 5 次的「页签切换不跟随」正是这个不同步的另一面）。
 */
watch(open, (isOpen) => {
  if (!isOpen) splitView.value = false
})

watch(
  available,
  (ok) => { if (!ok) void nextTick(() => emit('unavailable')) },
  { immediate: true },
)

/** 尺寸：卡片 340 / 分栏 588，高 380（用户 2026-11-07 指认，之前卡片被错误加宽成 520） */
const splitView = ref(false)
const menuWidth = computed(() => 'min(' + (splitView.value ? 588 : 340) + 'px, calc(100vw - 24px))')
const menuHeight = computed(() =>
  props.inDialog
    ? 'min(380px, calc(100dvh - 320px))'
    : 'min(380px, calc(100dvh - 180px))',
)
const menuSide = computed(() => (props.inDialog ? 'bottom' : splitView.value ? 'top' : 'bottom'))

/** 归一成 ChoicePicker 的行。**不传 platform**：交给 Agent 内部按标题识别（图标才对） */
const items = computed(() =>
  props.items.map((o) => ({
    id: o.id,
    title: o.title,
    subtitle: o.subtitle ?? '',
    note: o.note ?? '',
    isDefault: o.isDefault ?? o.id === props.currentId,
  })),
)

function pick(item: { id: string }): void {
  emit('pick', item.id)
  open.value = false
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="nb-action-select nb-model-trigger"
        type="button"
        :disabled="disabled"
        :aria-expanded="open"
        :title="triggerTitle"
        :aria-label="triggerTitle"
      >
        <span v-if="triggerIcon" class="nb-model-badge" :data-tone="triggerIcon.tone"
          aria-hidden="true" v-html="triggerIcon.svg" />
        <span class="nb-model-trigger-label">{{ triggerLabel }}</span>
        <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      :side="menuSide"
      update-position-strategy="always"
      class="nb-action-menu nb-model-menu nb-agent-choice-menu"
      :style="{ width: menuWidth, height: menuHeight }"
    >
      <AgentChoicePicker
        :items="items"
        :current-id="currentId"
        :title="title"
        :rail-label="railLabel"
        :placeholder="placeholder"
        :empty-text="emptyText"
        @pick="pick"
        @update:view="(v: 'card' | 'split') => (splitView = v === 'split')"
      />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<!--
  update-position-strategy="always"：卡片/分栏切换会改浮层宽高，默认 'optimized'
  策略下 popper 不重算，实测出现「页签已切到分栏、面板还停在卡片宽度」的中间态
  被固定住（用户 2026-11-07 连续反馈 5 次）。'always' 让位置/尺寸每帧同步。
-->

<style src="./bottom-bar-choice-menu.css"></style>
