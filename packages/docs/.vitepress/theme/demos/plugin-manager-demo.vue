<script setup lang="ts">
/**
 * plugin-manager-demo —— 「插件」设置页左导航项的活演示。
 *
 * 插件管理往设置面板登记了两件 UI：左导航项（settingsNav）与整页正文（settingsGroup/插件）。
 * 正文要读服务、要能装卸插件，只有真画布跑得起来；导航项只吃 { group, active, onSelect }
 * 三个 props，是纯展示件 —— 所以这里把它**真渲染出来**给读者看长得什么样。
 */
import { ref } from 'vue'
import PluginManagerNav from '../../../../plugins/plugin-manager/src/components/settings/PluginManagerNav.vue'

const active = ref('插件')
function onSelect(key: string): void {
  active.value = key
}
</script>

<template>
  <div style="padding: 16px; border-radius: 12px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft)">
    <div style="max-width: 220px; padding: 8px; border-radius: 12px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg)">
      <PluginManagerNav group="插件" :active="active === '插件'" :on-select="onSelect" />
      <div style="height: 6px" />
      <PluginManagerNav group="常规" :active="active === '常规'" :on-select="onSelect" />
    </div>
    <p style="margin: 12px 0 0; font-size: 12px; color: var(--vp-c-text-2)">
      真组件 <code>PluginManagerNav</code>：左边是「插件」项（激活态），下面是拿别的名字渲染的对照
      —— 组件本身固定显示「插件」两个字与拼图图标，<code>group</code> 只是它回传给面板的选中键。
    </p>
  </div>
</template>
