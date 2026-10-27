<script setup lang="ts">
// 抽屉插件页签正文：展示 host 窄接口能拿到什么（当前页签 / 宽度 / 收起状态）。
import { computed } from 'vue'

/** 与 ui 的 DrawerHost 同构（插件不 import @mini-canvas/ui，形状对齐即可） */
interface DrawerHost {
  readonly activeTab: string
  readonly width: number
  readonly collapsed: boolean
  openTab(id: string): void
  close(): void
  toggleCollapsed(): void
}

const props = defineProps<{ host: DrawerHost }>()
const width = computed(() => props.host.width)
</script>

<template>
  <div class="ssd-panel" data-testid="ssd-drawer-panel">
    <p class="ssd-title">外壳插槽演示</p>
    <ul class="ssd-list">
      <li>当前页签：{{ host.activeTab }}</li>
      <li>抽屉宽度：{{ width }}px</li>
      <li>是否收起：{{ host.collapsed ? '是' : '否' }}</li>
    </ul>
    <div class="ssd-actions">
      <button type="button" @click="host.close()">关闭抽屉</button>
      <button type="button" @click="host.toggleCollapsed()">收起/展开</button>
    </div>
  </div>
</template>

<style scoped>
.ssd-panel { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.ssd-title { margin: 0; font: 700 14px system-ui, 'Microsoft YaHei', sans-serif; color: var(--ui-ink, #18202b); }
.ssd-list { margin: 0; padding: 0 0 0 18px; font: 400 13px/1.7 system-ui, 'Microsoft YaHei', sans-serif; color: var(--ui-ink-dim, #4b5563); }
.ssd-actions { display: flex; gap: 8px; }
.ssd-actions button {
  height: 30px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--ui-line, rgba(0 0 0 / 0.12));
  background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font: 600 12px system-ui, sans-serif; cursor: pointer;
}
</style>
