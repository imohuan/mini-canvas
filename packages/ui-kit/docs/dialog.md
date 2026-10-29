# Dialog 对话框

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, Button, Input } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <div>
    <Button variant="primary" @click="open = true">打开对话框</Button>
    <Dialog v-model="open" title="编辑画布信息" description="所有字段都会保存到云。">
      <div class="dlg-demo">
        <Input placeholder="画布名称" aria-label="画布名称" />
        <Input placeholder="备注" aria-label="备注" />
        <p>长内容示例：对话框内部滚动，遮罩会锁定背景滚动。窄屏时面板自动贴近屏幕边缘，仍保留安全边距。</p>
      </div>
      <template #footer="{ close }">
        <Button variant="ghost" @click="close()">取消</Button>
        <Button variant="primary" @click="close()">保存</Button>
      </template>
    </Dialog>
  </div>
</template>
@@ENDVUE@@

- Esc、遮罩、× 都能关闭，可分别禁用。
- 焦点进面板，Tab 在面板内循环，关闭后还给原元素。
- 长内容内部滚动，不顶出屏幕。

