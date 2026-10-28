<script setup lang="ts">
/**
 * ThemedButtons —— 复用主题登记按钮的展示件。
 *
 * 按钮组件由宿主经 SlotComposer 的 sharedProps 下发（coreButton），不 import 任何主题包：
 * - variant="icon"：32×32 图标按钮（与底栏内置按钮同款）；
 * - variant="text"：带文案的文本按钮。
 *
 * 宿主没给 coreButton 时退回同尺寸的原生按钮，保证单独安装也看得见入口。
 */
import { computed } from 'vue'

const props = defineProps<{
  variant?: 'icon' | 'text'
  /** 宿主下发的默认按钮组件（SlotComposer sharedProps） */
  coreButton?: unknown
  /** 宿主下发的按钮档位：dock / status / tab（同一组件换尺寸） */
  buttonTone?: 'dock' | 'status' | 'tab'
}>()

const themed = computed(() => props.coreButton)

const ICON_GRID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
const ICON_ZAP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>'

const isIcon = computed(() => (props.variant ?? 'icon') === 'icon')
</script>

<template>
  <span class="ssd-themed" data-testid="ssd-themed">
    <component
      :is="themed"
      v-if="themed"
      :tone="buttonTone ?? 'dock'"
      title="插槽演示：网格视图"
      :icon="ICON_GRID"
      @click="() => {}"
    />
    <button v-else class="ssd-fallback" type="button" title="插槽演示：网格视图" @click="() => {}">
      <span class="ssd-icon" v-html="ICON_GRID" />
    </button>

    <component
      :is="themed"
      v-if="themed"
      :tone="buttonTone ?? 'dock'"
      :title="isIcon ? '插槽演示：主题按钮111' : '插槽演示：文本按钮11'"
      :icon="isIcon ? ICON_ZAP : undefined"
      @click="() => {}"
    >
      <template v-if="!isIcon">主题按钮11</template>
    </component>
    <button
      v-else
      class="ssd-fallback"
      type="button"
      :title="isIcon ? '插槽演示：主题按钮' : '插槽演示：文本按钮'"
      @click="() => {}"
    >
      <span v-if="isIcon" class="ssd-icon" v-html="ICON_ZAP" />
      <template v-else>主题按钮</template>
    </button>
  </span>
</template>

<style scoped>
.ssd-themed { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.ssd-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ntb-text, var(--ui-ink-dim, #6b7280));
  font: 600 12px system-ui, 'Microsoft YaHei', sans-serif;
  cursor: pointer;
}
.ssd-fallback:hover { background: var(--ntb-fill-hover, var(--ui-hover, rgb(0 0 0 / 0.06))); color: var(--ui-ink, #18202b); }
.ssd-icon { display: inline-flex; align-items: center; justify-content: center; }
</style>
