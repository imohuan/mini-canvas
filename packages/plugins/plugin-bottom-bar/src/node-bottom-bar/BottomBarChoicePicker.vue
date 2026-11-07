<script setup lang="ts">
/**
 * BottomBarChoicePicker —— 底栏的「生成动作」下拉，复用 Agent 的 ChoicePicker。
 *
 * 用户口径（2026-11-07）：
 * 「我 Agent 那个插件里面的模型下拉是有两种的：第一个是卡片形式，第二个是分栏形式。
 *   这边其实你的文本、图片和视频，下拉都可以使用这种方式。」
 *
 * 所以图片 / 视频的下拉不再是底栏自绘的简单菜单，而是 Agent 那套卡片 + 分栏面板：
 * - 面板主体来自 ui 场的 agentChoicePicker（Agent 未装时由父组件回退旧下拉）；
 * - 图标走 Agent 的 modelIcons 服务，与模型下拉同一套；
 * - 选中仍然只是「切换底栏动作」，参数区照旧在面板下面。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ModelIcon } from './modelIcons'

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

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const AgentChoicePicker = useUiComponent('agentChoicePicker')

const open = ref(false)
const available = computed(() => Boolean(AgentChoicePicker.value))

/**
 * 分栏视图要更宽更高：左栏是平台列表（按行竖排），
 * 卡片尺寸的 520×380 只放得下 6 行，多出来的平台会被切掉半行。
 */
const splitView = ref(false)
const menuWidth = computed(() => 'min(' + (splitView.value ? 588 : 520) + 'px, calc(100vw - 24px))')
/** 必须给确定高度，不能 auto：面板是 height:100%，父级 auto 会塌成 0（理由同 BottomBarModelPicker）。
 * 卡片与分栏同一高度（用户 2026-11-07）：切换时外壳尺寸不变，不卡顿不跳动；左栏自己滚。 */
const menuHeight = computed(() =>
  'min(380px, calc(100dvh - 180px))',
)
/** 分栏往上开：底栏下方只剩 300px 左右，放不下一整列平台 */
const menuSide = computed(() => (splitView.value ? 'top' : 'bottom'))

/**
 * 取不到就通知父组件（延到下一帧：这个通知会让父组件卸载本组件，
 * 在自己的挂载过程中触发会让 Vue 在 patch 里遇到已置空的 vnode）。
 */
watch(
  available,
  (ok) => { if (!ok) void nextTick(() => emit('unavailable')) },
  { immediate: true },
)

/** 归一成 ChoicePicker 的行 */
const items = computed(() =>
  props.options.map((o) => ({
    id: o.value,
    title: o.label,
    subtitle: o.group || o.description || '',
    note: o.note ?? '',
    platform: o.platform,
    isDefault: o.value === props.currentId,
  })),
)

function pick(item: { id: string }): void {
  emit('pick', item.id)
  open.value = false
}
</script>

<template>
  <DropdownMenu v-if="available" v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" :id="'nb-action-' + (currentId || 'none')"
        class="nb-action-select nb-model-trigger" type="button" :disabled="disabled"
        :aria-expanded="open" title="选择生成模型" aria-label="选择生成模型"
        data-testid="bar-choice-picker">
        <span v-if="currentModelIcon" class="nb-model-badge" :data-tone="currentModelIcon.tone"
          aria-hidden="true" v-html="currentModelIcon.svg" />
        <span class="nb-model-trigger-label">{{ currentLabel || '选择模型' }}</span>
        <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side="menuSide" class="nb-action-menu nb-model-menu nb-agent-choice-menu"
      :style="{ width: menuWidth, height: menuHeight }">
      <AgentChoicePicker
        :items="items"
        :current-id="currentId"
        title="生成模型"
        rail-label="平台"
        placeholder="搜索模型或平台"
        empty-text="没有匹配的模型"
        @pick="pick"
        @update:view="(v: 'card' | 'split') => (splitView = v === 'split')"
      />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<!-- 底栏作用域的尺寸覆盖（Agent 组件里的 class 不带本组件的 data-v，所以不用 scoped） -->
<style src="./bottom-bar-choice-menu.css"></style>

