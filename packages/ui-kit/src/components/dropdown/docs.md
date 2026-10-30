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

## 调整容器尺寸

`menu-width` / `menu-height` 控制浮层本身的大小；`menu-min-width`、`menu-max-width`、
`menu-max-height` 负责边界。固定高度配合 `layout="inner-scroll"`，可以让标题固定、列表自己滚。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Dropdown
    v-model="open"
    menu-width="280px"
    menu-height="180px"
    layout="inner-scroll"
    arrow
  >
    <template #trigger="{ open: isOpen }">
      <Button variant="secondary" :aria-expanded="isOpen">固定尺寸</Button>
    </template>
    <template #default>
      <div class="sized-menu">
        <strong>标题固定</strong>
        <button v-for="i in 20" :key="i" type="button">选项 {{ i }}</button>
      </div>
    </template>
  </Dropdown>
</template>
<style>
.sized-menu { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; }
.sized-menu strong { position: sticky; top: 0; padding: 4px 8px; background: var(--mck-panel); }
.sized-menu button { padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.sized-menu button:hover { background: var(--mck-hover); }
</style>
@@ENDVUE@@

## 显示箭头与对齐

`arrow` 打开后，箭头会贴住靠近触发器的那条边；`align` 控制横向对齐，
`start` 贴左缘、`center` 居中、`end` 贴右缘，`auto` 跟随 `placement` 后缀。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'

const open = ref(false)
</script>

<template>
  <Dropdown v-model="open" placement="bottom-start" align="center" arrow :offset="12">
    <template #trigger="{ open: isOpen }">
      <Button variant="secondary" :aria-expanded="isOpen">居中对齐</Button>
    </template>
    <template #default>
      <div style="min-width: 180px; padding: 4px">箭头朝上，指向按钮中心。</div>
    </template>
  </Dropdown>
</template>
@@ENDVUE@@

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| placement | bottom-start | 方位；也支持九宫格 top / left / right / bottom 与中轴写法 |
| anchor | 无 | 外部 DOM / Ref / getter；设置后浮层贴到这个元素上 |
| anchorPlacement | 无 | 九宫格方向；给外部锚点用 |
| offset | 6 | 与触发器的间距 |
| matchWidth | false | 浮层与触发器同宽 |
| arrow | false | 显示指向触发器的小箭头 |
| align | auto | auto / start / center / end |
| menuWidth | 无 | 浮层固定宽度 |
| menuHeight | 无 | 浮层固定高度 |
| menuMinWidth | 无 | 浮层最小宽度 |
| menuMaxWidth | 无 | 浮层最大宽度 |
| menuMaxHeight | 无 | 长列表内部滚动 |
| trigger | click | click / hover / contextmenu / always（always = 常显调试，v-model 失效） |
| layout | overlay-scroll | overlay-scroll / inner-scroll |
| teleport | true | 是否挂到 body |

## 绑定外部元素

页面里有一个嵌套很深的按钮时，可以只把 `anchor` 传给它，浮层就贴上去；
开关仍用 `v-model`。`anchor` 支持三种形式：直接 DOM、`ref`、或 getter。

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown } from '@mini-canvas/ui-kit'

const open = ref(false)
const anchorEl = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="deep-page">
    <div class="deep-toolbar">
      <button ref="anchorEl" type="button" @click="open = !open">深处的按钮</button>
    </div>

    <Dropdown v-model="open" :anchor="anchorEl" anchor-placement="bottom-start" arrow>
      <div class="deep-menu">这里通过外部 anchor 定位，不再需要触发器插槽。</div>
    </Dropdown>
  </div>
</template>
@@ENDVUE@@

