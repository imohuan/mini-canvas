# Dropdown 下拉容器

## 拖拽触发器演示

@@VUE@@
<script setup lang="ts">
import { ref } from 'vue'
import { Dropdown, Button } from '@mini-canvas/ui-kit'
import { Menu } from 'lucide-vue-next'

const open = ref(false)
const trigger = ref({ x: 32, y: 32 })
let dragging = false
let start = { x: 0, y: 0 }

function down(event: PointerEvent): void {
  dragging = true
  start = { x: event.clientX - trigger.value.x, y: event.clientY - trigger.value.y }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function move(event: PointerEvent): void {
  if (!dragging) return
  trigger.value = {
    x: Math.max(8, Math.min(event.clientX - start.x, window.innerWidth - 160)),
    y: Math.max(8, Math.min(event.clientY - start.y, window.innerHeight - 120)),
  }
}
function up(): void {
  dragging = false
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
}
</script>

<template>
  <div class="dd-demo">
    <div class="dd-demo__stage">
      <div class="dd-demo__trigger" :style="{ left: trigger.x + 'px', top: trigger.y + 'px' }">
        <Dropdown v-model="open" menu-min-width="220px" menu-max-height="220px">
          <template #trigger="{ open: isOpen }">
            <Button variant="secondary" :aria-expanded="isOpen" @pointerdown="down">
              <Menu :size="15" style="margin-right: 6px" />拖我
            </Button>
          </template>
          <template #default="{ close }">
            <div class="dd-menu-demo">
              <button type="button" @click="close()">操作一</button>
              <button type="button" @click="close()">操作二</button>
              <button type="button" disabled>禁用项</button>
              <button v-for="i in 12" :key="i" type="button" @click="close()">长列表 {{ i }}</button>
            </div>
          </template>
        </Dropdown>
      </div>
      <p class="dd-demo__hint">拖动按钮到屏幕边缘，观察浮层翻转和夹取；滚轮滚动时浮层持续跟随。</p>
    </div>
  </div>
</template>

<style>
.dd-menu-demo {
  display: flex;
  flex-direction: column;
  min-width: 200px;
}
.dd-menu-demo button {
  display: block;
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
.dd-menu-demo button:hover:not(:disabled) { background: var(--mck-hover, rgb(0 0 0 / 0.06)); }
.dd-menu-demo button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
@@ENDVUE@@

Dropdown 是触发器 + 任意浮层的容器：

- trigger：click / hover / contextmenu。
- placement：bottom-start 等 13 个方位，空间不足自动翻转。
- 菜单贴视口边缘时被夹回，不会跑出屏幕。
- 长列表通过 menuMaxHeight 内部滚动。
- 外点、Esc 关闭；同一时刻全局只保留一个非嵌套浮层。

| 属性 | 默认 | 说明 |
| --- | --- | --- |
| placement | bottom-start | 方位 |
| offset | 6 | 与触发器的间距 |
| matchWidth | false | 浮层与触发器同宽 |
| menuWidth / menuMinWidth / menuMaxWidth / menuMaxHeight | 无 | 尺寸控制 |
| trigger | click | click / hover / contextmenu |
| layout | overlay-scroll | overlay-scroll / inner-scroll |
| teleport | true | 是否挂到 body |
| arrow | false | 要不要小箭头 |
| disabled | false | 禁用触发 |

