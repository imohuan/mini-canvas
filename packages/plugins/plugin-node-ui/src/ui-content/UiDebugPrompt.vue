<script setup lang="ts">
import { useUiComponent } from '@plume-canvas/canvas-render'

defineEmits<{
  dismiss: []
  accept: []
}>()

const Button = useUiComponent('Button')
</script>

<template>
  <div class="debug-prompt" role="dialog" aria-modal="true" aria-label="调试连接确认">
    <div class="debug-prompt-card">
      <div class="debug-prompt-title">调试连接请求</div>
      <p class="debug-prompt-text">
        Agent 想连接这个节点的界面进行调试。本画布开了多个标签页，
        请只在<strong>你想用来调试的这个标签页</strong>点同意。同意后：
        该节点会与后台建立调试连接，并阻止意外刷新（刷新前会再确认）。
      </p>
      <div class="debug-prompt-actions">
        <Button type="button" class="debug-btn-ghost" variant="ghost" size="sm" @click.stop="$emit('dismiss')">先不连</Button>
        <Button type="button" class="debug-btn-primary" variant="default" size="sm" @click.stop="$emit('accept')">同意调试</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 调试确认框（ui-style-guide：浮层材质 + 主按钮唯一实心）==================== */
.debug-prompt {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-scrim, rgba(0, 0, 0, 0.32));
  border-radius: inherit;
}
.debug-prompt-card {
  width: calc(100% - 32px);
  max-width: 340px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  background: var(--ui-overlay-solid, #ffffff);
  backdrop-filter: blur(20px);
  box-shadow: var(--ui-shadow-e2, 0 20px 40px rgba(0, 0, 0, 0.08));
}
.debug-prompt-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong, #111827);
  margin-bottom: 8px;
}
.debug-prompt-text {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-body, #374151);
}
.debug-prompt-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.debug-btn-ghost {
  height: auto;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  background: transparent;
  color: var(--text-muted, #6b7280);
  font-size: 12px;
  font-weight: 600;
}
.debug-btn-ghost:hover {
  background: var(--fill-hover, rgba(0, 0, 0, 0.05));
}
.debug-btn-primary {
  height: auto;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-on-accent, #fff);
  font-size: 12px;
  font-weight: 600;
}
.debug-btn-primary:hover {
  background: var(--ui-accent-hover, #0e7490);
}
@media (prefers-reduced-motion: reduce) {
  .debug-prompt-card {
    transition: none;
  }
}
</style>
