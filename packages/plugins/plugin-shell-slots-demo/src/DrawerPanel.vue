<script setup lang="ts">
/**
 * 抽屉插件页签正文：展示 host 窄接口 + 上下文数据（节点数 / 主题按钮）。
 *
 * 数据全部由 index.ts 在 apply(ctx) 里准备好后经 props 传入：
 * - host：宿主抽屉的窄接口；
 * - nodeCount：doc 服务订阅出来的节点数；
 * - button：ui 注册场里当前主题登记的按钮。
 *
 * 本组件不取 ctx、不读 window、不 import 画布包。
 */
import type { DrawerHost } from './types'

const props = defineProps<{
  host: DrawerHost
  nodeCount?: number
  button?: unknown
}>()

function width(): number {
  return props.host.width
}
</script>

<template>
  <div class="ssd-panel" data-testid="ssd-drawer-panel">
    <p class="ssd-title">外壳插槽演示</p>
    <ul class="ssd-list">
      <li>当前页签：{{ host.activeTab }}</li>
      <li>抽屉宽度：{{ width() }}px</li>
      <li>是否收起：{{ host.collapsed ? '是' : '否' }}</li>
      <li>当前节点数：{{ nodeCount ?? 0 }}</li>
    </ul>

    <div v-if="button" class="ssd-actions">
      <component :is="button" title="关闭抽屉" @click="host.close()">关闭抽屉</component>
      <component :is="button" title="收起或展开抽屉" @click="host.toggleCollapsed()">收起/展开</component>
    </div>
    <div v-else class="ssd-actions">
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
