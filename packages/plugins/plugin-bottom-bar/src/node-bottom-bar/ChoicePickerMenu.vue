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
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { ModelIcon } from './modelIcons'

export interface PickerItem {
  id: string
  title: string
  subtitle?: string
  note?: string
  /**
   * 这一行自己的图标（provider 的 icon / 图标名 / 兜底）。
   *
   * 不传时面板按标题猜平台 —— 那正是「触发器有图标、列表里全是兜底」的由来：
   * Agent 的 ChoicePicker 只认标题。传了就优先用这里的，列表与触发器才对得上。
   */
  icon?: ModelIcon | null
  /** 这一行所属平台的账号（多于一个才在行尾出「账号」二级菜单） */
  accounts?: Array<{ id: string; name?: string }>
  /** 当前选中的账号 id（空 = 平台默认号） */
  accountId?: string
  /** 平台默认账号 id：选的就是它时不往触发器上再写一遍名字 */
  defaultAccount?: string
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
    /** 当前动作可选的账号（多于一个才显示「账号」入口） */
    accounts?: Array<{ id: string; name?: string }>
    /** 当前选中的账号（空 = 用平台默认号） */
    accountId?: string
    /** 平台默认账号 id（选了它就等于「按默认跑」，触发器不再写名字） */
    defaultAccount?: string
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
  /** 选了某个账号（不改变当前动作，只记这个号） */
  pickAccount: [id: string, accountId: string]
}>()

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const AgentChoicePicker = useUiComponent('agentChoicePicker')
const open = ref(false)
const available = computed(() => Boolean(AgentChoicePicker.value))

/**
 * 当前选中的账号名（触发器文本后面显示；没选就空着）。
 *
 * 选的就是平台默认号时不显示：**默认号本来就是「不指定」的意思**，
 * 再写一段「· 默认」只会把模型名挤短（用户 2026-11-10 截图）。
 */
const accountName = computed(() => {
  const list = props.accounts ?? []
  if (list.length <= 1) return ''
  if (!props.accountId) return ''
  if (props.defaultAccount && props.accountId === props.defaultAccount) return ''
  return list.find((a) => a.id === props.accountId)?.name ?? props.accountId
})

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

/**
 * 归一成 ChoicePicker 的行。
 *
 * `svg` 是逐行的图标（完整 `<svg>` / `<img>` 字符串）。给了就由面板原样渲染；
 * 没给才回落 Agent 内部「按标题猜平台」。
 * 不在这一层传 platform：面板的 platform 还决定分栏左列的分组，
 * 按 icon 猜出来的 key 会让分组与图标互相打架。
 */
const items = computed(() =>
  props.items.map((o) => ({
    id: o.id,
    title: o.title,
    subtitle: o.subtitle ?? '',
    note: o.note ?? '',
    // 「默认」标签已删（用户 2026-11-10）：底栏没选中时默认取第一项，不再标哪一行
    ...(o.icon?.svg ? { svg: o.icon.svg } : {}),
    // 多账号：行尾二级菜单用（只有一个号时面板不渲染箭头）
    ...(o.accounts && o.accounts.length > 0 ? { accounts: o.accounts } : {}),
    ...(o.accountId ? { accountId: o.accountId } : {}),
    ...(o.defaultAccount ? { defaultAccount: o.defaultAccount } : {}),
  })),
)

function pick(item: { id: string }): void {
  emit('pick', item.id)
  open.value = false
}

/**
 * 在行内二级菜单里选了账号：只记账号，面板留着。
 *
 * 账号是「给下一次生成用哪个号」的修饰，不是「执行」。选完面板不关，
 * 用户可以接着点模型行；关掉面板后触发器文本后面会显示这个号的名字。
 */
function pickAccount(itemId: string, accountId: string): void {
  emit('pickAccount', itemId, accountId)
}
</script>

<template>
  <span class="nb-choice-wrap">
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="nb-action-select nb-model-trigger"
        :class="{ 'has-account': Boolean(accountName) }"
        type="button"
        :disabled="disabled"
        :aria-expanded="open"
        :title="triggerTitle"
        :aria-label="triggerTitle"
      >
        <span v-if="triggerIcon" class="nb-model-badge" :data-tone="triggerIcon.tone"
          aria-hidden="true" v-html="triggerIcon.svg" />
        <span class="nb-model-trigger-label">{{ triggerLabel }}</span>
        <span v-if="accountName" class="nb-account-chip">· {{ accountName }}</span>
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
        @pick-account="pickAccount"
        @update:view="(v: 'card' | 'split') => (splitView = v === 'split')"
      />
    </DropdownMenuContent>
  </DropdownMenu>
  </span>
</template>

<!--
  update-position-strategy="always"：卡片/分栏切换会改浮层宽高，默认 'optimized'
  策略下 popper 不重算，实测出现「页签已切到分栏、面板还停在卡片宽度」的中间态
  被固定住（用户 2026-11-07 连续反馈 5 次）。'always' 让位置/尺寸每帧同步。
-->

<style src="./bottom-bar-choice-menu.css"></style>
