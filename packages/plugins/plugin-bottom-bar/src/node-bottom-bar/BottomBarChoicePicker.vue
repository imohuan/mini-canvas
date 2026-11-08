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
}

const props = defineProps<{
  options: ActionChoice[]
  currentId: string
  currentLabel: string
  currentModelIcon: ModelIcon | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  pick: [value: string]
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
    data-testid="bar-choice-picker"
    @pick="emit('pick', $event)"
    @unavailable="emit('unavailable')"
  />
</template>

