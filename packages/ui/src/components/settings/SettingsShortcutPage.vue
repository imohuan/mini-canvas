<script setup lang="ts">
/**
 * 设置页「快捷键」入口。
 *
 * 成品应用不冷启动 plugin-shortcut-manager（命令分发与底部帮助浮层由外壳自带），
 * 但设置页需要它的重映射面板。这里先从宿主命令表现建并安装管理器，再渲染面板；
 * 子组件 setup 时会立即读取管理器，所以这两步的顺序不能反。
 */
import SettingsShortcutPanel from '@mini-canvas/plugin-shortcut-manager/SettingsShortcutPanel.vue'
import { useUi } from '../../composables/ui'

defineOptions({ inheritAttrs: false })

useUi().ensureShortcutManager()
</script>

<template>
  <SettingsShortcutPanel />
</template>
