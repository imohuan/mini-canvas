<script setup lang="ts">
/**
 * 抽屉插件页签按钮：宿主通过 props 下发 active / onSelect / host。
 *
 * host 是宿主抽屉的窄接口（切页签、关抽屉、收起展开），
 * 本组件不 import 宿主 UI 包，只按形状使用。
 */
import type { DrawerHost } from './types'

const props = defineProps<{
  active: boolean
  onSelect: () => void
  host: DrawerHost
}>()

function onClick(): void {
  // 防御：宿主必给 onSelect；万一某宿主没给，退回 host.openTab（两者语义一致）。
  if (typeof props.onSelect === 'function') props.onSelect()
  else props.host.openTab(props.host.activeTab)
}
</script>

<template>
  <button
    class="ssd-tab"
    :class="{ active }"
    type="button"
    role="tab"
    :aria-selected="active"
    data-testid="ssd-drawer-tab"
    @click="onClick"
  >演示</button>
</template>

<style scoped>
.ssd-tab {
  height: 28px;
  padding: 0 12px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font: 500 13px system-ui, 'Microsoft YaHei', sans-serif;
  cursor: pointer;
}
.ssd-tab.active {
  background: var(--ui-hover-strong, rgba(0 0 0 / 0.1));
  color: var(--ui-ink, #18202b);
  font-weight: 700;
}
</style>
