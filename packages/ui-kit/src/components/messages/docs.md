# Messages 轻提示

## 基础

顶部居中一条，几秒后自己消失，不打断操作。

@@VUE@@
<script setup lang="ts">
import { MessagesHost, message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <MessagesHost />
    <Button variant="secondary" @click="message('已复制到剪贴板')">普通</Button>
    <Button variant="secondary" @click="message({ text: '保存成功', tone: 'success' })">成功</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 语义语气

@@VUE@@
<script setup lang="ts">
import { MessagesHost, message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <MessagesHost />
    <Button variant="ghost" @click="message({ text: '已加入队列', tone: 'info' })">信息</Button>
    <Button variant="ghost" @click="message({ text: '缓存快满了', tone: 'warning' })">警告</Button>
    <Button variant="ghost" @click="message({ text: '导出失败', tone: 'danger' })">错误</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

## 长文本与常驻

`duration=0` 不自动消失；长文本会自动换行，不撑破顶部。

@@VUE@@
<script setup lang="ts">
import { MessagesHost, message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="wall">
    <MessagesHost />
    <Button variant="secondary" @click="message({ text: '内容包含较长的中文与 English mixed text，看看换行表现。', tone: 'info' })">长文本</Button>
    <Button variant="secondary" @click="message({ text: '这条不会自己消失', duration: 0 })">常驻</Button>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

