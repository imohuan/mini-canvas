<script setup lang="ts">
/**
 * DemoSlotContent —— 自定义内容区插槽测试组件（plugin-node-image 演示用）。
 *
 * 被注册进 `settingsGroup/高级` 插槽 → 接管"高级"分组的**右侧内容区渲染**
 * （对话框发现该分组有内容插槽 occupant，就不再走默认 schema 渲染）。
 * 通过 props 收到： group（分组 key）、settings（SettingsPanelSource）。
 *
 * 这里展示与"默认 schema 渲染"不同的自绘内容：把该组字段列出来 + 一个自定义开关控件。
 * store 非响应式，用 settings.onChange 驱动版本号刷新取值（与 SettingsSchemaField 同思路）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

const props = defineProps<{
  group?: string
  settings?: SettingsPanelSource
}>()

const tick = ref(0)
let unsub: { dispose(): void } | undefined
onBeforeUnmount(() => unsub?.dispose())
onMounted(() => {
  unsub = props.settings?.onChange(() => void (tick.value += 1))
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entries = computed<any[]>(() => {
  void tick.value
  if (!props.settings || !props.group) return []
  return props.settings.groupOf(props.group)
})

function toggle(key: string, checked: boolean): void {
  props.settings?.set(key, checked)
}
</script>

<template>
  <div class="dsc">
    <div class="dsc-badge">自定义内容插槽接管（settingsGroup/{{ group }}）</div>
    <div v-for="e in entries" :key="e.key" class="dsc-row">
      <span class="dsc-name">{{ e.schema.label ?? e.key }}</span>
      <!-- 仅演示：boolean 渲染成自绘开关，其余按文本展示当前值 -->
      <button
        v-if="e.schema.type === 'boolean'"
        class="dsc-btn"
        :class="{ on: !!e.value }"
        @click="toggle(e.key, !e.value)"
      >
        {{ e.value ? 'ON' : 'OFF' }}
      </button>
      <code v-else class="dsc-val">{{ e.value }}</code>
    </div>
  </div>
</template>

<style scoped>
.dsc {
  padding: 6px 0;
  font-size: 12px;
}
.dsc-badge {
  display: inline-block;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  margin-bottom: 8px;
}
.dsc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-top: 1px dashed #f0f1f3;
}
.dsc-row:first-of-type {
  border-top: none;
}
.dsc-name {
  font-weight: 500;
}
.dsc-btn {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #f9fafb;
  padding: 2px 12px;
  cursor: pointer;
  font-size: 12px;
}
.dsc-btn.on {
  background: #4f7cff;
  color: #fff;
  border-color: #4f7cff;
}
.dsc-val {
  font-family: ui-monospace, monospace;
  color: #64748b;
}
</style>
