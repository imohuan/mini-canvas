<!-- 文件：packages/docs/public/examples/canvas-render/settings-slot-host/src/DemoSettingsPage.vue -->
     格式：Vue 单文件组件（挂在 settingsGroup/我的演示 槽）
     位置：插件包内部；它拿到的是统一设置数据源，不自己读内核 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender, type SettingsPanelSource } from '@mini-canvas/canvas-render'

// ① 设置面板宿主会把数据源当 prop 传进来（名字固定叫 settings）
const props = defineProps<{ settings: SettingsPanelSource }>()
const { ctx } = useCanvasRender()

// ② 读自己那一项的值；面板宿主负责在配置变化时让它重渲染
const noteSize = computed(() => {
  const entry = props.settings.groupOf('我的演示').find((e) => e.key === 'demoText')
  return String(entry?.value ?? '')
})

function setDemoText(v: string) {
  props.settings.set('demoText', v)   // ③ 写回内核配置（持久化由 save.settings 负责）
}
</script>

<template>
  <section>
    <label>
      我的设置项
      <input :value="noteSize" @input="setDemoText(($event.target as HTMLInputElement).value)" />
    </label>
  </section>
</template>
