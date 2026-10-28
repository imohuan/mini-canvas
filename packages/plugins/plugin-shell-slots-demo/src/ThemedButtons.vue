<script setup lang="ts">
/**
 * ThemedButtons —— 全部使用宿主下发的内置按钮（coreButton）。
 *
 * 按钮组件由 SlotComposer 的 sharedProps 下发，本文件不再自绘任何按钮：
 * - 第一个：固定 icon 形态（网格图标）；
 * - 第二个：按 variant 决定 icon / text（缺省 icon）。
 *
 * 宿主没给 coreButton 时不渲染按钮（内置按钮是外壳提供的，插件不复制一套样式）。
 */
import { computed, defineComponent, h } from 'vue'

const props = defineProps<{
  variant?: 'icon' | 'text'
  /** 宿主下发的默认按钮组件（SlotComposer sharedProps） */
  coreButton?: unknown
  /** 宿主下发的按钮档位：dock / status / tab（同一组件换尺寸） */
  buttonTone?: 'dock' | 'status' | 'tab'
}>()

/**
 * 模板里直接写 <CoreButton> 需要一个"首字母大写的组件名"。
 *
 * 为什么不再用动态组件标签：宿主下发的按钮就是一个普通组件值，
 * 取成具名后模板可读性更好、类型/编辑器提示也更好；两者运行时等价。
 */
const CoreButton = defineComponent({
  name: 'CoreButton',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => {
      const comp = props.coreButton
      if (!comp) return null
      return h(comp as never, attrs, slots)
    }
  },
})

const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
const ICON_ZAP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>'

const isIcon = computed(() => (props.variant ?? 'icon') === 'icon')
</script>

<template>
  <span class="ssd-themed" data-testid="ssd-themed">
    <CoreButton
      :tone="buttonTone ?? 'dock'"
      variant="icon"
      title="插槽演示：网格视图"
      :icon="ICON_GRID"
      @click="() => {}"
    />

    <CoreButton
      :tone="buttonTone ?? 'dock'"
      :variant="isIcon ? 'icon' : 'text'"
      :title="isIcon ? '插槽演示：主题按钮' : '插槽演示：文本按钮'"
      :icon="isIcon ? ICON_ZAP : undefined"
      @click="() => {}"
    >
      <template v-if="!isIcon">主题按钮</template>
    </CoreButton>
  </span>
</template>

<style scoped>
.ssd-themed { display: inline-flex; align-items: center; gap: 4px; flex: none; }
</style>
