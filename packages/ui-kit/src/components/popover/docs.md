# Popover 气泡卡片

## 表单卡片

标题 + 说明 + 表单 + 底部按钮，是一个小型编辑面板。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Popover, Button, Input } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Popover v-model="open" title="重命名画布" description="长内容会在卡片内滚动。" width="340px">
    <template #trigger>
      <Button variant="secondary">打开 Popover</Button>
    </template>
    <template #default>
      <Input placeholder="新名称" aria-label="新名称" />
    </template>
    <template #footer="{ close }">
      <Button variant="ghost" @click="close()">取消</Button>
      <Button variant="primary" @click="close()">保存</Button>
    </template>
  </Popover>
</template>
@@ENDVUE@@

## 无标题的轻提示

不传 title 时没有头部，只剩内容区；点外面和 Esc 都能关。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Popover, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Popover v-model="open" width="260px">
    <template #trigger>
      <Button variant="ghost">这是什么？</Button>
    </template>
    <template #default>
      <p class="hint">画布里的节点会自动保存；关闭浏览器也不会丢。</p>
    </template>
  </Popover>
</template>
<style scoped>
.hint { margin: 0; color: var(--mck-ink-muted); font-size: 12px; line-height: 1.7; }
</style>
@@ENDVUE@@

## 不同方向

`placement` 控制优先出现的方位，空间不足会自动翻转。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Popover, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <div class="wall">
    <Popover v-model="open" placement="top-start" width="200px">
      <template #trigger>
        <Button variant="secondary">上方</Button>
      </template>
      <template #default><p class="hint">出现在上方。</p></template>
    </Popover>
    <Popover v-model="open" placement="right-start" width="200px">
      <template #trigger>
        <Button variant="secondary">右侧</Button>
      </template>
      <template #default><p class="hint">出现在右侧。</p></template>
    </Popover>
  </div>
</template>
<style scoped>
.wall { display: flex; flex-wrap: wrap; gap: 10px; }
.hint { margin: 0; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

## 禁用

`disabled` 时触发器不响应，但外观不变。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Popover, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Popover v-model="open" disabled>
    <template #trigger>
      <Button variant="ghost">点我没反应</Button>
    </template>
    <template #default><p>不会打开。</p></template>
  </Popover>
</template>
@@ENDVUE@@

- closeOnOutside / closeOnEscape 可分别关。
- 打开时焦点进面板，关闭后还给触发器。

## 复用 Dropdown 的配置

Popover 建在 Dropdown 上，Dropdown 的方向、箭头、触发方式、外部锚点都能用：

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| placement | bottom-start | 九宫格方向 |
| trigger | click | click / hover / contextmenu |
| hoverCloseDelay | 150 | 悬停关闭缓冲 |
| arrow | false | 显示指向触发器的小箭头 |
| anchor | 无 | 外部 DOM / Ref / getter |
| appendTo | body | 浮层挂载容器 |
| menuHeight | 无 | 卡片固定高度 |
| layout | overlay-scroll | 内容滚动方式 |

面板外观固定由 Popover 自己画（卡片 + 标题 + 关闭按钮），
需要完全自定义就用 Dropdown 的 `bare`。
