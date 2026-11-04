<script setup lang="ts">
/**
 * 设置页「快捷键」入口。
 *
 * 成品应用不冷启动 plugin-shortcut-manager（命令分发与底部帮助浮层由外壳自带），
 * 但设置页需要它的重映射面板：这里先建并安装管理器，再渲染面板。
 * 面板 setup 时会立即读管理器，所以两步顺序不能反。
 *
 * ctx 由父级设置面板经 provide 下来（设置面板不在画布渲染子树里，拿不到 useCanvasRender）。
 *
 * 面板是 settings.nav 的一页（meta.page 指向本组件），由设置面板按 navPage 渲染。
 */
import { inject } from 'vue'
import SettingsShortcutPanel from '@mini-canvas/plugin-shortcut-manager/SettingsShortcutPanel.vue'
import {
  SETTINGS_SHORTCUT_HOST,
  ensureShortcutManager,
} from '../../composables/ensureShortcutManager'

defineOptions({ inheritAttrs: false })

ensureShortcutManager(inject(SETTINGS_SHORTCUT_HOST, undefined))
</script>

<template>
  <SettingsShortcutPanel />
</template>
