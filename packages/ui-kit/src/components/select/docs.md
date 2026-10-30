# Select 选择器

## 可搜索 + 分组

相邻同名分组自动合并；打开后直接输入过滤，Enter 选中高亮项。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Select } from '@mini-canvas/ui-kit'

const value = ref('video')
const options = [
  { value: 'image', label: '图片', description: 'PNG / JPG', group: '节点' },
  { value: 'video', label: '视频', description: 'MP4 / WEBM', group: '节点' },
  { value: 'audio', label: '音频', description: 'MP3 / WAV', group: '节点' },
  { value: 'clean', label: '清理画布', group: '操作', disabled: true },
]
</script>

<template>
  <Select v-model="value" :options="options" searchable aria-label="选择节点" />
</template>
@@ENDVUE@@

## 空值 + 可清空

传 `null` 表示没选，清空后回到 placeholder。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Select } from '@mini-canvas/ui-kit'

const value = ref<string | null>(null)
const options = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]
</script>

<template>
  <Select v-model="value" :options="options" clearable placeholder="请选择类型" aria-label="选择类型" />
</template>
@@ENDVUE@@

## 宽下拉

`menu-min-width` 让选项更长时不被裁切。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Select } from '@mini-canvas/ui-kit'

const value = ref('video')
const options = [
  { value: 'video', label: '视频', description: 'MP4 / WEBM / MOV，最大 2GB' },
  { value: 'audio', label: '音频', description: 'MP3 / WAV / FLAC' },
]
</script>

<template>
  <Select v-model="value" :options="options" menu-min-width="300px" aria-label="宽下拉" />
</template>
@@ENDVUE@@

## 禁用与空列表

@@VUE@@
<script setup lang="ts">
import { Select } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="col">
    <Select :model-value="'video'" :options="[{ value: 'video', label: '视频' }]" disabled aria-label="禁用" />
    <Select :model-value="null" :options="[]" aria-label="空列表" />
  </div>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 12px; width: min(280px, 100%); }
</style>
@@ENDVUE@@

- searchable：打开后直接输入过滤，Enter 选中当前高亮项。
- group：相邻同名分组会合并显示。
- 键盘：上下移动高亮、Enter 选中、Esc 关闭。

