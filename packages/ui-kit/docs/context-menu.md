# ContextMenu 右键菜单

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { ContextMenu, type ContextMenuItem } from '@mini-canvas/ui-kit'

const items: ContextMenuItem[] = [
  { id: 'open', label: '打开', icon: '↗', shortcut: 'Enter', group: '文件' },
  { id: 'rename', label: '重命名', icon: '✎', shortcut: 'F2', group: '文件' },
  { id: 'theme', label: '主题', icon: '🎨', group: '外观', children: [
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
  ] },
  { id: 'divider', label: '', divider: true },
  { id: 'copy', label: '复制', icon: '⧉', shortcut: 'Ctrl+C', group: '编辑', disabled: true },
  { id: 'delete', label: '删除', icon: '🗑', shortcut: 'Del', group: '危险', danger: true },
]
const menu = ref()

function show(event: MouseEvent): void {
  menu.value?.showAt(event.clientX, event.clientY)
}
</script>

<template>
  <div class="ctx-demo" @contextmenu.prevent="show">
    在这块区域点右键
    <ContextMenu ref="menu" :items="items" @select="(item) => console.log(item.id)" />
  </div>
</template>
<style scoped>
.ctx-demo { display: grid; width: 100%; min-height: 120px; place-items: center; border: 1px dashed var(--mck-line); border-radius: 10px; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

- 支持分组、图标、快捷键、禁用、危险项和一级子菜单。
- 靠近屏幕边缘自动夹回，子菜单空间不足时向左翻。
- 方向键移动焦点，Esc 关闭，外点关闭。

