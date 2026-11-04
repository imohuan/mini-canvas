<script setup lang="ts">
/**
 * 抽屉插件页签正文：host 来自宿主 props；按钮从 ui 注册表取，节点数自己从上下文取。
 */
import { onBeforeUnmount, shallowRef } from 'vue'
import { useCanvasContext, useUiComponent } from '@mini-canvas/canvas-render'
import type { DrawerHost } from './types'

const props = defineProps<{
  host: DrawerHost
}>()
const { ctx } = useCanvasContext()

const Button = useUiComponent('Button')

const doc = ctx.tryGet<{ getNodes(): unknown[]; subscribe(fn: () => void): () => void }>('doc')
const nodeCount = shallowRef(doc ? doc.getNodes().length : 0)
const offDoc = doc?.subscribe(() => {
  nodeCount.value = doc.getNodes().length
})

onBeforeUnmount(() => {
  offDoc?.()
})
</script>

<template>
  <div class="ssd-panel" data-testid="ssd-drawer-panel">
    <p class="ssd-title">外壳插槽演示</p>
    <ul class="ssd-list">
      <li>当前页签：{{ props.host.activeTab }}</li>
      <li>抽屉宽度：{{ props.host.width }}px</li>
      <li>是否收起：{{ props.host.collapsed ? '是' : '否' }}</li>
      <li>当前节点数：{{ nodeCount }}</li>
    </ul>

    <div class="ssd-actions">
      <Button v-if="Button" variant="ghost" size="sm" type="button" title="关闭抽屉" @click="props.host.close()">关闭抽屉</Button>
      <Button v-if="Button" variant="ghost" size="sm" type="button" title="收起或展开抽屉" @click="props.host.toggleCollapsed()">收起/展开</Button>
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
