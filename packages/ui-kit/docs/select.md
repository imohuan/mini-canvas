# Select 选择器

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
  <div class="select-demo">
    <Select v-model="value" :options="options" searchable aria-label="选择节点" />
    <Select :model-value="null" :options="options" placeholder="请选择类型" clearable />
    <Select :model-value="value" :options="[]" disabled aria-label="禁用" />
    <Select :model-value="value" :options="options" menu-min-width="280px" aria-label="宽下拉" />
  </div>
</template>
<style scoped>
.select-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
</style>
@@ENDVUE@@

- searchable：打开后直接输入过滤，Enter 选中当前高亮项。
- group：相邻同名分组会合并显示。
- 键盘：上下移动高亮、Enter 选中、Esc 关闭。
- 空态：没有匹配项时显示“没有匹配的选项”。

