# Notify 通知

@@VUE@@
<script setup lang="ts">
import { NotifyHost, notify, Button } from '@mini-canvas/ui-kit'

let index = 0
</script>

<template>
  <div class="notify-demo">
    <NotifyHost />
    <Button variant="secondary" @click="notify({ title: '已保存', description: '画布刚刚保存到云端。', tone: 'success' })">成功</Button>
    <Button variant="secondary" @click="notify({ title: '上传中', description: '第 ' + (++index) + ' 个文件上传中。', tone: 'primary' })">进行中</Button>
    <Button variant="secondary" @click="notify({ title: '同步失败', description: '网络不稳定，稍后自动重试。', tone: 'danger', duration: 0, action: { label: '立即重试', onClick: () => notify({ title: '重试中…', tone: 'primary' }) } })">失败</Button>
  </div>
</template>
<style scoped>
.notify-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
</style>
@@ENDVUE@@

- 连续弹出会叠在右上角。
- duration 为 0 表示不自动关闭，需要手动点 ×。
- action 提供一个操作按钮。

