# Dropdown 下拉容器

## 点击打开

最常用的一档：点触发器开，点外面或 Esc 关。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Dropdown v-model="open">
    <template #trigger="{ open: isOpen }">
      <Button variant="secondary" :aria-expanded="isOpen">打开菜单</Button>
    </template>
    <template #default="{ close }">
      <div class="menu">
        <button type="button" @click="close()">重命名</button>
        <button type="button" @click="close()">复制</button>
        <button type="button" disabled>禁用项</button>
      </div>
    </template>
  </Dropdown>
</template>
<style>
.menu { display: flex; flex-direction: column; min-width: 180px; }
.menu button {
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.menu button:hover:not(:disabled) { background: var(--mck-hover); }
.menu button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
@@ENDVUE@@

## 悬停打开

`trigger="hover"` 适合工具栏的速览浮层；离开有一小段缓冲，移进浮层不会闪退。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Dropdown v-model="open" trigger="hover">
    <template #trigger>
      <Button variant="ghost">悬停展开</Button>
    </template>
    <template #default>
      <div class="tip">悬停浮层，鼠标移进来不会关。</div>
    </template>
  </Dropdown>
</template>
<style>
.tip { min-width: 200px; padding: 4px; color: var(--mck-ink-muted); font-size: 12px; }
</style>
@@ENDVUE@@

## 长列表内部滚动

`menu-max-height` 到顶后菜单自身滚动，页面不动。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Dropdown v-model="open" menu-max-height="160px" layout="overlay-scroll">
    <template #trigger="{ open: isOpen }">
      <Button variant="secondary" :aria-expanded="isOpen">20 个选项</Button>
    </template>
    <template #default="{ close }">
      <div class="menu">
        <button v-for="i in 20" :key="i" type="button" @click="close()">选项 {{ i }}</button>
      </div>
    </template>
  </Dropdown>
</template>
<style>
.menu { display: flex; flex-direction: column; min-width: 180px; }
.menu button {
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.menu button:hover { background: var(--mck-hover); }
</style>
@@ENDVUE@@

## 匹配触发器宽度

`match-width` 让浮层和触发器同宽，像原生 select 展开。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <div style="width: min(260px, 100%)">
    <Dropdown v-model="open" match-width>
      <template #trigger="{ open: isOpen }">
        <Button block :aria-expanded="isOpen">选择类型</Button>
      </template>
      <template #default="{ close }">
        <div class="menu">
          <button type="button" @click="close()">图片</button>
          <button type="button" @click="close()">视频</button>
          <button type="button" @click="close()">音频</button>
        </div>
      </template>
    </Dropdown>
  </div>
</template>
<style>
.menu { display: flex; flex-direction: column; }
.menu button {
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.menu button:hover { background: var(--mck-hover); }
</style>
@@ENDVUE@@

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| placement | bottom-start | 方位，空间不足自动翻转 |
| offset | 6 | 与触发器的间距 |
| matchWidth | false | 浮层与触发器同宽 |
| menuMaxHeight | 无 | 长列表内部滚动 |
| trigger | click | click / hover / contextmenu |
| layout | overlay-scroll | overlay-scroll / inner-scroll |
| teleport | true | 是否挂到 body |

