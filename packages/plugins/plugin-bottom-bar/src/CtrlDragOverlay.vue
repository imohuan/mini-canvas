<script setup lang="ts">
/**
 * CtrlDragOverlay —— Ctrl 选择态的**顶部操作栏 + Esc 提示**（fixed 浮层）。
 *
 * 节点高亮由 NodeCtrlDragOverlay 承担（overlay 槽组件，长在节点里跟随变换 —— 用户口径）。
 * 本组件只负责顶部操作栏与底部 Esc 提示。
 *
 * 状态读 globalThis.__miniCanvasCtrlDrag：发起方（底栏）与本组件可能来自不同模块
 * 实例（热重载 UMD 拷贝 vs bundle 拷贝），模块 ref 不共享 —— enter/exit 同步写
 * globalThis 并广播 mini-canvas:ctrl-drag-mode 事件。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

function readActive(): boolean {
  return !!(globalThis as { __miniCanvasCtrlDrag?: { active: boolean } }).__miniCanvasCtrlDrag?.active
}

const active = ref(readActive())
function syncActive(): void {
  active.value = readActive()
}

onMounted(() => {
  window.addEventListener('mini-canvas:ctrl-drag-mode', syncActive)
})
onBeforeUnmount(() => {
  window.removeEventListener('mini-canvas:ctrl-drag-mode', syncActive)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="cd-root" data-testid="ctrl-drag-overlay">
      <div class="cd-top" @pointerdown.stop>
        <span class="cd-top-text">按住 Ctrl 拖资源到参考格</span>
        <button class="cd-top-close" type="button" title="退出 (Esc)" aria-label="退出" @pointerdown.stop @click="syncActive">
          <span aria-hidden="true" v-html="ICON_CLOSE" />
        </button>
      </div>
      <div class="cd-esc">
        <span class="cd-esc-key">ESC</span>
        <span>按 Esc 退出</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cd-root { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
.cd-top { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-radius: 14px; background: var(--ui-accent); color: #ffffff; box-shadow: var(--ui-shadow-lg, 0 12px 32px rgb(15 23 42 / 0.28)); pointer-events: auto; }
.cd-top-text { font-size: 13px; font-weight: 600; white-space: nowrap; }
.cd-top-close { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 10px; background: rgb(255 255 255 / 0.16); color: #ffffff; cursor: pointer; }
.cd-top-close:hover { background: rgb(255 255 255 / 0.28); }
.cd-top-close svg { width: 15px; height: 15px; }
.cd-esc { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; }
.cd-esc-key { font-weight: 700; }
</style>
