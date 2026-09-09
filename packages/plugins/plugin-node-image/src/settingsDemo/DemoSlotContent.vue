<script setup lang="ts">
/**
 * DemoSlotContent —— 自定义内容区插槽测试组件（plugin-node-image 演示用）。
 *
 * 被注册进 `settingsGroup/图片/阴影` 且 meta.mode='append' → 与「图片/阴影」二级分组的**默认 schema 控件并存**：
 *   右侧先渲染该分组的默认控件（阴影开关），本组件再追加在其下方。
 * 通过 props 收到： group（完整分组 key）、settings（SettingsPanelSource）。
 *
 * 这里刻意**不重复**该组 schema 字段（避免与默认控件撞车），而是渲染一块自定义补充 UI，
 * 用来验证"默认 SettingsSchemaField 与插件自定义组件可以同时存在"。
 * store 非响应式，用 settings.onChange 驱动版本号刷新取值（与 SettingsSchemaField 同思路）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 只声明本组件用到的 settings 最小形状（避免 demo 组件反向依赖 canvas-render）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface LiteSettings {
  groupOf(group: string): Array<{ key: string; value: string | number | boolean; schema: { label?: string; type?: string } }>
  set(key: string, value: string | number | boolean): boolean
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

const props = defineProps<{
  group?: string
  settings?: LiteSettings
}>()

const tick = ref(0)
let unsub: { dispose(): void } | undefined
onBeforeUnmount(() => unsub?.dispose())
onMounted(() => {
  unsub = props.settings?.onChange(() => void (tick.value += 1))
})

// 演示一个附加开关：仅本地视觉，说明"插槽自绘组件可以带自己的交互 UI"（并存场景并不要求它必须写配置）。
const on = ref(false)
function toggle(): void {
  on.value = !on.value
}
</script>

<template>
  <div class="dsc">
    <div class="dsc-badge">下方为自定义并存组件（settingsGroup/{{ group }} · mode=append）</div>
    <p class="dsc-note">
      这一段是 image 插件用插槽追加进来的自定义内容，与上方该组的默认控件同时存在 ——
      证明"默认 SettingsSchemaField 与插件自定义组件能并存"。
    </p>
    <div class="dsc-extra">
      <span class="dsc-name">演示附加开关</span>
      <span class="dsc-pill" :class="{ on }" @click="toggle">{{ on ? '开启' : '关闭' }}</span>
    </div>
  </div>
</template>

<style scoped>
.dsc {
  padding: 8px 0;
  margin-top: 6px;
  font-size: 12px;
  border-top: 2px dashed #c7d2fe;
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
.dsc-note {
  margin: 0 0 8px;
  color: #475569;
  line-height: 1.6;
}
.dsc-extra {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 220px;
}
.dsc-name {
  font-weight: 500;
}
.dsc-pill {
  padding: 2px 14px;
  border-radius: 999px;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}
.dsc-pill.on {
  background: #4f7cff;
  color: #fff;
  border-color: #4f7cff;
}
</style>
