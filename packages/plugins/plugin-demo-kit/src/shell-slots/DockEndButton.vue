<script setup lang="ts">
/**
 * 底栏末尾按钮：点击动作由组件自己从上下文取 command 服务。
 */
import { useCanvasContext } from '@mini-canvas/canvas-render'

const context = useCanvasContext()
const { ctx, host: { command } } = context

function openDrawer(): void {
  // ctx.tryGet<{ execute(id: string): unknown }>('command')?.execute('shell:open-drawer')
  command.execute("shell:open-drawer")
}   
</script>

<template>
  <button class="ss-demo-btn" type="button" data-testid="ssd-dock-end" @click="openDrawer">
    插槽按钮
  </button>
</template>

<style scoped>
.ss-demo-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--ui-line, rgba(0 0 0 / 0.12));
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  font: 600 13px system-ui, 'Microsoft YaHei', sans-serif;
  cursor: pointer;
}

.ss-demo-btn:hover {
  background: var(--ui-hover, rgba(0 0 0 / 0.05));
}
</style>
