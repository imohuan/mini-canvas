<script setup lang="ts">
/**
 * BottomBarModelPicker —— 底栏的「模型」下拉（复用 Agent 的 ModelPicker）。
 *
 * 用户口径（2026-11-07）：
 * 「在 Agent 插件 UI 里面就有一个配置好的模型下拉菜单，你是否可以把他作为一个组件
 *   注册到上下文场域中，然后在底部状态栏中直接使用，这样他们就可以共用。」
 *
 * 做法：
 * - Agent 在 `apply` 里把 ModelPicker 登记进 `ui` 场（名字 agentModelPicker）；
 * - 这里按名取件，面板主体完全复用，不再自己写一份；
 * - 图标由 Agent 的 `modelIcons` 服务提供，两处同一套。
 *
 * 与 Agent 的差别只有一个：**选中不等于换会话**。
 * 底栏只把 provider/modelId 记下来，发送时随请求带给 Agent 的单轮接口。
 *
 * Agent 没装（取不到组件）时：退回原来的动作下拉（由父组件决定），这里只负责报告。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { resolveModelRowIcon, type ModelIcon, type ModelIconServiceLike } from './actionIcon'
import type { ModelRowLike } from './modelPickerBridge'

const props = defineProps<{
  /** Agent 里的全量模型（含未配密钥的，组件内部自己筛） */
  models: ModelRowLike[]
  /** 当前选中的模型（底栏记住的那一份，不是 Agent 会话的） */
  model: { provider: string; modelId: string } | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  pick: [model: { provider: string; modelId: string }]
  /** 取不到 Agent 的组件时，通知父组件回退到动作下拉 */
  unavailable: []
}>()

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
/** Agent 注册的模型面板；没装 Agent 时是 undefined */
const AgentModelPicker = useUiComponent('agentModelPicker')
/** 渲染上下文：取 Agent 的 modelIcons 服务（与面板同一把图标尺子） */
const { ctx } = useCanvasRender()
/** 模型图标服务：Agent 提供时按平台给品牌图，没装 Agent 时用本地兜底 */
const iconService = computed<ModelIconServiceLike | undefined>(() => ctx.tryGet('modelIcons'))

/**
 * 面板宽度：分栏视图要宽一点，否则左栏平台列表被挤成一条缝（400px 实测只能露半行）。
 * 与 Agent 输入区同一口径：卡片 340 / 分栏 588（再按视口收）。
 */
const splitView = ref(false)
const menuWidth = computed(() => 'min(' + (splitView.value ? 588 : 340) + 'px, calc(100vw - 24px))')
/**
 * 面板高度：给**确定值**，不用 max-height。
 *
 * 为什么：只给上限时，分栏左栏的滚动区拿不到可用高度，最后一行会被裁掉一半
 * （用户 2026-11-07 截图：阶跃星辰只露了半行）。确定高度下 height:100% 才有意义。
 */
const menuHeight = computed(() =>
  /*
   * 卡片与分栏**同一高度**（用户 2026-11-07：分栏太高了）。
   *
   * 之前分栏给 560：左栏想一次放下全部平台，结果浮层比卡片高出一截，切换时
   * 外壳先变高再变矮，观感就是「卡顿 + 抖」。统一 360 后：
   * · 左栏自己滚（.ac-rail-scroll 是 flex:1 的 ScrollArea，够用）；
   * · 外壳尺寸在两种视图间不变，切换只有内容淡入淡出，不触发布局跳动。
   */
  'min(360px, calc(100dvh - 180px))',
)
/** 分栏往上开：底栏贴着画布下方，向下放不下整列平台（两种视图同高后方向也固定，不跳） */
const menuSide = computed(() => (splitView.value ? 'top' : 'bottom'))
const open = ref(false)
const available = computed(() => Boolean(AgentModelPicker.value))

/**
 * 取不到就告诉父组件一次：底栏据此退回原下拉，不让用户面对一个空按钮。
 *
 * 必须延到下一帧再说：这个通知会让父组件卸载本组件；若发生在自己的挂载/更新过程中，
 * Vue 会在 patch 里遇到已置空的 vnode（实测：Cannot set properties of null (setting __vnode)）。
 */
watch(
  available,
  (ok) => { if (!ok) void nextTick(() => emit('unavailable')) },
  { immediate: true },
)

/** 触发器上显示的名字：优先 displayName，否则 modelId */
const label = computed(() => {
  if (!props.model) return '选择模型'
  const hit = props.models.find((m) => m.provider === props.model!.provider && m.modelId === props.model!.modelId)
  return hit?.displayName || props.model.modelId
})

/** 触发器左侧的模型图标（用户 2026-11-09：与图片/视频/音频同款） */
const icon = computed<ModelIcon | null>(() => {
  if (!props.model) return null
  const hit = props.models.find((m) => m.provider === props.model!.provider && m.modelId === props.model!.modelId)
  return resolveModelRowIcon(props.model.modelId, props.model.provider, iconService.value, hit?.displayName)
})

function pick(m: { provider: string; modelId: string }): void {
  emit('pick', m)
  open.value = false
}
</script>

<template>
  <DropdownMenu v-if="available" v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="nb-action-select nb-model-trigger" type="button"
        :disabled="disabled" :aria-expanded="open" title="选择模型" aria-label="选择模型"
        data-testid="bar-model-picker">
        <span v-if="icon" class="nb-model-badge" :data-tone="icon.tone" aria-hidden="true" v-html="icon.svg" />
        <span class="nb-model-trigger-label">{{ label }}</span>
        <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side="menuSide" class="nb-model-menu nb-agent-model-menu"
      :style="{ width: menuWidth, height: menuHeight }">
      <!-- 不传 compact：卡片 / 分栏两个视图都保留（用户 2026-11-07） -->
      <!-- 视图受控：面板是唯一状态源，底栏只跟随它改浮层尺寸（不反向写回） -->
      <AgentModelPicker :models="models" :current="model" @pick="pick" @update:view="(v: 'card' | 'split') => (splitView = v === 'split')" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<!--
  底栏作用域的尺寸覆盖（.nb-agent-model-menu 里的 .ac-panel 收窄）。
  不能用 scoped：这些 class 在 Agent 的组件里渲染，不带本组件的 data-v。
-->
<style src="./bottom-bar-model-menu.css"></style>

