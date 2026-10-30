# Confirm 确认框

## 危险操作

`danger` 把确认键变红；`confirm-text` 写清楚动作本身，不要只写“确定”。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Confirm, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="danger" @click="open = true">删除画布</Button>
  <Confirm
    v-model="open"
    title="删除画布？"
    description="这个操作会立即生效，删除后无法恢复。"
    confirm-text="删除"
    cancel-text="保留"
    danger
  >
    <p class="note">画布里还有 3 个节点和 12 个资产。</p>
  </Confirm>
</template>
<style scoped>
.note { margin: 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

## 普通确认

不放危险色，用于需要留意的普通选择。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Confirm, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Button variant="secondary" @click="open = true">离开页面</Button>
  <Confirm v-model="open" title="离开当前画布？" description="未保存的改动会保留在本地草稿里。" confirm-text="离开" cancel-text="留下" />
</template>
@@ENDVUE@@

## 提交中

`loading` 时两个按钮都禁用，避免重复提交。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Confirm, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
const loading = ref(false)
async function run(): Promise<void> {
  loading.value = true
  await new Promise((r) => setTimeout(r, 1200))
  loading.value = false
}
</script>

<template>
  <Button variant="primary" @click="open = true">提交</Button>
  <Confirm
    v-model="open"
    title="发布到云端？"
    confirm-text="发布"
    :loading="loading"
    @confirm="run"
  >
    <p class="note">发布会把当前版本推给所有协作者。</p>
  </Confirm>
</template>
<style scoped>
.note { margin: 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

- 基于 Dialog，继承焦点、ESC、遮罩行为。
- 确认后组件会自己关闭，再派发 confirm 事件。

