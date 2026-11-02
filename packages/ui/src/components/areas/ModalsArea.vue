<script setup lang="ts">
// 浮层区入口：快捷键 / 生成历史 / TV Director 设置。
import ShortcutModal from './modals-area/ShortcutModal.vue'
import HistoryModal from './modals-area/HistoryModal.vue'
import DirectorSettingsDialog from './modals-area/DirectorSettingsDialog.vue'
import { useUi } from '../../composables/ui'

const s = useUi().state
</script>

<template>
  <ShortcutModal @close="s.shortcutsOpen = false" />
  <HistoryModal />
  <DirectorSettingsDialog />
</template>
