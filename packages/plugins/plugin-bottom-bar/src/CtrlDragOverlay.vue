<script setup lang="ts">
/**
 * CtrlDragOverlay —— Ctrl 选择态的顶部操作栏 + Esc 提示（fixed 浮层）。
 *
 * 节点高亮由 NodeSelectOverlay(mode=ctrl-drag) 承担（节点覆盖层，跟随变换）。
 * 本组件只负责顶栏与底部 Esc 提示。
 *
 * 状态读 globalThis.__miniCanvasCtrlDrag：发起方（底栏）与本组件可能来自不同模块
 * 实例，模块 ref 不共享 —— enter/exit 同步写 globalThis 并广播事件。
 */
import { onBeforeUnmount, onMounted, ref } from "vue"

// SlotHost 会下发 class/data-slot-*；本组件根是 fragment/teleport，继承不了，
// 显式关掉避免 Vue 的“多余属性”warn 刷屏（e2e 有一条控制台纯净断言）。
defineOptions({ inheritAttrs: false })

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

function readActive(): boolean {
  return !!(globalThis as { __miniCanvasCtrlDrag?: { active: boolean } }).__miniCanvasCtrlDrag?.active
}

const active = ref(readActive())
function syncActive(): void {
  active.value = readActive()
}
/** 点关闭 = 真正退出选择态（之前只同步了本组件状态，会话没退 —— 点了没效果） */
function close(): void {
  ;(globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag = { active: false, owner: "" }
  window.dispatchEvent(new CustomEvent("mini-canvas:ctrl-drag-mode"))
  syncActive()
}

onMounted(() => {
  window.addEventListener("mini-canvas:ctrl-drag-mode", syncActive)
})
onBeforeUnmount(() => {
  window.removeEventListener("mini-canvas:ctrl-drag-mode", syncActive)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="cd-root" data-testid="ctrl-drag-overlay">
      <div class="cd-top" @pointerdown.stop>
        <span class="cd-top-text">按住 Ctrl 拖资源到参考格</span>
        <button class="cd-top-close" type="button" title="退出（Esc）" @pointerdown.stop @click.stop="close">
          <span class="cd-top-close-icon" aria-hidden="true" v-html="ICON_CLOSE" />
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
/* 主题色白名单: 紫底操作条上的白字与阴影，白与紫成对 */
.cd-top { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 8px 0 14px; border-radius: 14px; background: var(--ui-accent); color: #ffffff; box-shadow: var(--ui-shadow-lg, 0 12px 32px rgb(15 23 42 / 0.28)); pointer-events: auto; }
.cd-top-text { font-size: 13px; font-weight: 600; white-space: nowrap; }
/* 主题色白名单: 紫底上的白色按钮，白与紫成对 */
.cd-top-close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: rgb(255 255 255 / 0.18); color: #ffffff; cursor: pointer; }
.cd-top-close:hover { /* 主题色白名单: 同上 */ background: rgb(255 255 255 / 0.3); }
/* svg 靠 v-html 注入，scoped 样式命不中 —— 用 :deep 并显式给尺寸（之前 0×0 就是这么来的） */
.cd-top-close :deep(svg) { width: 15px; height: 15px; display: block; }
.cd-esc { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; }
.cd-esc-key { font-weight: 700; }
</style>

