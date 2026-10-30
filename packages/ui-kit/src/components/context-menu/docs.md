# ContextMenu 右键菜单

## 分组 + 快捷键

同名 `group` 相邻合成一组，组与组之间自动加分割线。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { ContextMenu, type ContextMenuItem } from '@mini-canvas/ui-kit'

const menu = ref<InstanceType<typeof ContextMenu> | null>(null)
const items: ContextMenuItem[] = [
  { id: 'open', label: '打开', icon: '↗', shortcut: 'Enter', group: '文件' },
  { id: 'rename', label: '重命名', icon: '✎', shortcut: 'F2', group: '文件' },
  { id: 'copy', label: '复制', icon: '⧉', shortcut: 'Ctrl+C', group: '编辑' },
]
function show(event: MouseEvent): void {
  menu.value?.showAt(event.clientX, event.clientY)
}
</script>

<template>
  <div class="area" @contextmenu.prevent="show">
    在这块区域点右键
    <ContextMenu ref="menu" :items="items" />
  </div>
</template>
<style scoped>
.area {
  display: grid;
  width: 100%;
  min-height: 120px;
  place-items: center;
  border: 1px dashed var(--mck-line);
  border-radius: 10px;
  color: var(--mck-ink-muted);
  font-size: 12px;
}
</style>
@@ENDVUE@@

## 子菜单

带 `children` 的项右侧出现 `›`，悬停展开；靠近右边缘会自动向左翻。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { ContextMenu, type ContextMenuItem } from '@mini-canvas/ui-kit'

const menu = ref<InstanceType<typeof ContextMenu> | null>(null)
const items: ContextMenuItem[] = [
  { id: 'theme', label: '主题', icon: '🎨', group: '外观', children: [
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
  ] },
  { id: 'zoom', label: '缩放', group: '外观', children: [
    { id: 'in', label: '放大' },
    { id: 'out', label: '缩小' },
  ] },
]
function show(event: MouseEvent): void {
  menu.value?.showAt(event.clientX, event.clientY)
}
</script>

<template>
  <div class="area" @contextmenu.prevent="show">
    右键试试子菜单
    <ContextMenu ref="menu" :items="items" />
  </div>
</template>
<style scoped>
.area {
  display: grid;
  width: 100%;
  min-height: 120px;
  place-items: center;
  border: 1px dashed var(--mck-line);
  border-radius: 10px;
  color: var(--mck-ink-muted);
  font-size: 12px;
}
</style>
@@ENDVUE@@

## 禁用与危险项

`disabled` 置灰不可点；`danger` 文字转红，用在删除类操作。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { ContextMenu, type ContextMenuItem } from '@mini-canvas/ui-kit'

const menu = ref<InstanceType<typeof ContextMenu> | null>(null)
const items: ContextMenuItem[] = [
  { id: 'paste', label: '粘贴', icon: '⎘', shortcut: 'Ctrl+V', group: '编辑', disabled: true },
  { id: 'clone', label: '创建副本', group: '编辑' },
  { id: 'delete', label: '删除', icon: '🗑', shortcut: 'Del', group: '危险', danger: true },
]
function show(event: MouseEvent): void {
  menu.value?.showAt(event.clientX, event.clientY)
}
</script>

<template>
  <div class="area" @contextmenu.prevent="show">
    右键看禁用和危险项
    <ContextMenu ref="menu" :items="items" />
  </div>
</template>
<style scoped>
.area {
  display: grid;
  width: 100%;
  min-height: 120px;
  place-items: center;
  border: 1px dashed var(--mck-line);
  border-radius: 10px;
  color: var(--mck-ink-muted);
  font-size: 12px;
}
</style>
@@ENDVUE@@

- 方向键移动焦点，Esc 关闭，外点关闭。
- 靠近屏幕边缘自动夹回。

