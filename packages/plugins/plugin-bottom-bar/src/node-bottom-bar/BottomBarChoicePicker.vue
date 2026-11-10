<script setup lang="ts">
/**
 * BottomBarChoicePicker —— 底栏的「生成动作」下拉。
 *
 * 2026-11-07：触发器 / 面板 / 图标的实现收进 ChoicePickerMenu（弹窗「适用模型」也要用），
 * 这里只负责把底栏的动作清单翻译成它的 props。此后两处 UI 只有一份实现，不会再长歪。
 */
import { computed } from 'vue'
import type { ModelIcon } from './modelIcons'
import ChoicePickerMenu from './ChoicePickerMenu.vue'

/** 一行动作：底栏 actionOptions 的子集 + 需要的展示信息 */
export interface ActionChoice {
  value: string
  label: string
  description?: string
  group?: string
  /** 参数摘要（比例 / 时长…），显示在副标题 */
  note?: string
  /** 平台 key（用于分栏聚合）；认不出时按名字猜 */
  platform?: string
  model?: ModelIcon
  /** 这个动作所属平台的账号（多于一个时，菜单行右侧出「账号」二级菜单） */
  accounts?: Array<{ id: string; name?: string }>
  /** 当前选中的账号 id（不选 = 平台默认号） */
  accountId?: string
}

const props = defineProps<{
  options: ActionChoice[]
  currentId: string
  currentLabel: string
  currentModelIcon: ModelIcon | null
  disabled?: boolean
  /** 当前动作所属平台的账号（多于一个才在触发器上显示账号入口） */
  accounts?: Array<{ id: string; name?: string }>
  accountId?: string
}>()

const emit = defineEmits<{
  pick: [value: string]
  /** 选中某个账号（`value` 是动作 id） */
  pickAccount: [value: string, accountId: string]
  /** Agent 未装：父组件据此回退到旧的动作下拉 */
  unavailable: []
}>()

const items = computed(() =>
  props.options.map((o) => ({
    id: o.value,
    title: o.label,
    subtitle: o.group || o.description || '',
    note: o.note ?? '',
    isDefault: o.value === props.currentId,
    /** 每行自己的图标：与触发器同一份，列表里不会再退回兜底图形 */
    icon: o.model ?? null,
    accounts: o.accounts,
    accountId: o.accountId,
  })),
)
</script>

<template>
  <ChoicePickerMenu
    :items="items"
    :current-id="currentId"
    :trigger-label="currentLabel || '选择模型'"
    :trigger-icon="currentModelIcon"
    trigger-title="选择生成模型"
    title="生成模型"
    :disabled="disabled"
    :accounts="accounts"
    :account-id="accountId"
    data-testid="bar-choice-picker"
    @pick="emit('pick', $event)"
    @pick-account="(id: string, acc: string) => emit('pickAccount', id, acc)"
    @unavailable="emit('unavailable')"
  />
</template>

