# Popover 气泡卡片

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Popover, Button, Input } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Popover v-model="open" title="重命名画布" description="长内容会在卡片内滚动。" width="340px">
    <template #trigger="{ toggle }">
      <Button variant="secondary" @click="toggle">打开 Popover</Button>
    </template>
    <template #default="{ close }">
      <Input placeholder="新名称" aria-label="新名称" />
      <p class="pop-demo__hint">点外部、Esc 或右上角 × 都能关闭。</p>
    </template>
    <template #footer="{ close: close2 }">
      <Button variant="ghost" @click="close2()">取消</Button>
      <Button variant="primary" @click="close2()">保存</Button>
    </template>
  </Popover>
</template>
<style scoped>
.pop-demo__hint { margin: 10px 0 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

- closeOnOutside / closeOnEscape 可分别关。
- 内容超长时内部滚动，卡片不顶出视口。
- 打开时焦点进面板，关闭后还给触发器。

