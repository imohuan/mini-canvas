<script setup lang="ts">
/**
 * 抽屉插件页签正文：host 与默认按钮来自宿主 props；节点数由组件自己从上下文取。
 */
import { onBeforeUnmount, shallowRef, type Component } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'
import type { DrawerHost } from './types'

const props = defineProps<{
  host: DrawerHost
  /** 宿主下发的默认按钮组件（SlotComposer sharedProps） */
  coreButton?: unknown
  /** 宿主下发的按钮档位（dock / status / tab） */
  buttonTone?: 'dock' | 'status' | 'tab'
}>()
const { ctx } = useCanvasContext()

/** 宿主下发的按钮组件本身就是组件，直接当标签用（不包适配组件） */
const CoreButton = props.coreButton as Component | undefined

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
      <CoreButton v-if="CoreButton" :tone="props.buttonTone ?? 'dock'" variant="text" title="关闭抽屉" @click="props.host.close()">关闭抽屉</CoreButton>
      <CoreButton v-if="CoreButton" :tone="props.buttonTone ?? 'dock'" variant="text" title="收起或展开抽屉" @click="props.host.toggleCollapsed()">收起/展开</CoreButton>
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
