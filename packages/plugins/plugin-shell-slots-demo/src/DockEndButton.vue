<script setup lang="ts">
// 底栏末尾演示按钮：用外壳命令打开抽屉（不反向依赖 @mini-canvas/ui）。
async function onOpenDrawer(): Promise<void> {
  const w = globalThis as { MiniCanvasUI?: { getContext(): { get(name: string): { execute(id: string, payload?: unknown): void } } } }
  const command = w.MiniCanvasUI?.getContext().get('command')
  command?.execute('shell:open-drawer')
}
</script>

<template>
  <button class="ss-demo-btn" type="button" data-testid="ssd-dock-end" @click="onOpenDrawer">
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
.ss-demo-btn:hover { background: var(--ui-hover, rgba(0 0 0 / 0.05)); }
</style>
