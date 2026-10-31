<script setup lang="ts">
// 文件：packages/docs/public/examples/packages\docs\public\examples\command\plugin-command-demo\src\src/CommandBar.vue
// 格式：Vue 单文件组件（setup 语法糖）
// 位置：注册进 overlay 槽的 UI，列出本插件分组的命令并执行
import { onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasRender()
const canvas = ctx.get('canvas')

const GROUP = 'command-demo'

// ① 从命令表里挑出本插件分组的命令（不自己抄一份按钮清单）
function listMine() {
  return canvas.listCommands().filter((c) => c.group === GROUP)
}
const items = ref(listMine())

// ② 命令表会变（插件热装/热卸）→ 订阅内核事件重读
const off = ctx.on('ctx:plugin-installed', () => (items.value = listMine()))
const off2 = ctx.on('ctx:plugin-uninstalled', () => (items.value = listMine()))
onBeforeUnmount(() => {
  off.dispose()
  off2.dispose()
})

// ③ 点击 = 按 id 执行；可用性也问命令表（when 由 execute 自己再判一次）
function fire(id: string): void {
  canvas.runCommand(id)
}
</script>

<template>
  <div class="command-demo-bar">
    <button
      v-for="c in items"
      :key="c.id"
      type="button"
      :disabled="c.when ? !c.when(ctx) : false"
      @click="fire(c.id)"
    >
      {{ c.title ?? c.id }}
    </button>
  </div>
</template>

<style scoped>
.command-demo-bar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 6px;
}
.command-demo-bar button {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  cursor: pointer;
}
</style>

