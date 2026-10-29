# Messages 轻提示

@@VUE@@
<script setup lang="ts">
import { MessagesHost, message, Button } from '@mini-canvas/ui-kit'
</script>

<template>
  <div class="msg-demo">
    <MessagesHost />
    <Button variant="secondary" @click="message('已复制到剪贴板')">普通</Button>
    <Button variant="secondary" @click="message({ text: '保存成功', tone: 'success' })">成功</Button>
    <Button variant="secondary" @click="message({ text: '内容包含较长的中文与 English mixed text，看看换行表现。', tone: 'info' })">长文本</Button>
  </div>
</template>
@@ENDVUE@@

顶部居中，短时反馈；连续出现会向上堆叠。

