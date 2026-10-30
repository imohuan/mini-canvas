# Dialog 对话框

## 表单对话框

标题、说明、表单、底部按钮，是 Dialog 最常见的骨架。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, Button, Input } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="primary" @click="open = true">打开对话框</Button>
  <Dialog v-model="open" title="编辑画布信息" description="所有字段都会保存到云。">
    <div class="col">
      <Input placeholder="画布名称" aria-label="画布名称" />
      <Input placeholder="备注" aria-label="备注" />
    </div>
    <template #footer="{ close }">
      <Button variant="ghost" @click="close()">取消</Button>
      <Button variant="primary" @click="close()">保存</Button>
    </template>
  </Dialog>
</template>
<style scoped>
.col { display: flex; flex-direction: column; gap: 10px; }
</style>
@@ENDVUE@@

## 长内容内部滚动

内容超过 `max-height` 时面板内部滚动，遮罩会锁住背景。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="secondary" @click="open = true">打开长内容</Button>
  <Dialog v-model="open" title="使用条款" width="520px">
    <p v-for="i in 16" :key="i" class="para">
      第 {{ i }} 段：对话框内部滚动，遮罩会锁定背景滚动。窄屏时面板自动贴近屏幕边缘，仍保留安全边距。
    </p>
  </Dialog>
</template>
<style scoped>
.para { margin: 0 0 10px; color: var(--mck-ink-muted); font-size: 12px; line-height: 1.8; }
</style>
@@ENDVUE@@

## 只有内容

不传标题时没有头部；`show-close=false` 时只能靠 Esc 或遮罩关。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="ghost" @click="open = true">无标题对话框</Button>
  <Dialog v-model="open" :show-close="false" width="360px">
    <p class="para">这段没有任何头部，只有一个内容区。</p>
  </Dialog>
</template>
<style scoped>
.para { margin: 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

## 不能点遮罩关闭

`close-on-overlay=false` 逼用户明确选一个，避免误关丢数据。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="secondary" @click="open = true">必须处理</Button>
  <Dialog
    v-model="open"
    title="还有未保存的改动"
    description="点遮罩不会关闭，只能选一个。"
    :close-on-overlay="false"
    :show-close="false"
    width="380px"
  >
    <template #footer="{ close }">
      <Button variant="ghost" @click="close()">丢弃</Button>
      <Button variant="primary" @click="close()">保存</Button>
    </template>
  </Dialog>
</template>
@@ENDVUE@@

- Esc、遮罩、× 都能关闭，可分别禁用。
- 焦点进面板，Tab 在面板内循环，关闭后还给原元素。

