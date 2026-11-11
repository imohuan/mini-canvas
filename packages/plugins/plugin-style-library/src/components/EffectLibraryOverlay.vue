<script setup lang="ts">
/**
 * EffectLibraryOverlay —— 特效库的**弹窗外壳**（画布模式下使用）。
 *
 * 与风格库同一套外壳，只换标题；内容在 EffectLibraryContent.vue。
 * 项目页的「特效库」页签直接用内容组件，不套这层弹窗。
 */
import { computed, onBeforeUnmount, onMounted, ref, Teleport, watch } from 'vue'
import { X, Minus } from 'lucide-vue-next'
import { useCanvasContextOrRender } from '@plume-canvas/canvas-render'
import type { LibraryService } from '../data/store'
import EffectLibraryContent from './EffectLibraryContent.vue'

/** 根节点是 Teleport：槽宿主传下来的 class / data-slot-* 无处可落。 */
defineOptions({ inheritAttrs: false })

// 宽松取件：本浮层注册在画布 overlay 槽里。
const { ctx } = useCanvasContextOrRender()
const svc = ctx.get<LibraryService>('effect-library')
const s = svc.state

const minimized = ref(false)
const visible = computed(() => s.open && !minimized.value)

function onKey(e: KeyboardEvent): void {
  if (!s.open) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    svc.close()
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))

watch(
  () => s.open,
  (v) => {
    if (!v) minimized.value = false
  },
)

function onUsed(): void {
  svc.close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="elol-layer" @pointerdown.self="svc.close()" @contextmenu.prevent>
      <div class="elol-panel" @pointerdown.stop>
        <header class="elol-head">
          <h3 class="elol-title">素材库 · 特效库</h3>
          <div class="elol-head-actions">
            <button class="elol-icon" type="button" aria-label="最小化" title="最小化" @click="minimized = true">
              <Minus :size="16" />
            </button>
            <button class="elol-icon" type="button" aria-label="关闭特效库" title="关闭" @click="svc.close()">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="elol-body">
          <EffectLibraryContent @used="onUsed" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.elol-layer {
  position: fixed;
  inset: 0;
  z-index: var(--ui-layer-dialog, var(--layer-modal, 100000));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, var(--ui-scrim-soft, rgb(15 23 42 / 0.16)), var(--ui-scrim-soft, rgb(15 23 42 / 0.26)));
  backdrop-filter: blur(2px);
}
.elol-panel {
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: min(86vh, 860px);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
  overflow: hidden;
  animation: elol-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes elol-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}
.elol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 10px 10px 10px 18px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.elol-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.elol-head-actions { display: flex; gap: 4px; }
.elol-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.elol-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.elol-icon:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.elol-body { flex: 1; min-height: 0; display: flex; }

@media (prefers-reduced-motion: reduce) {
  .elol-panel, .elol-icon { transition: none !important; animation: none !important; }
}
</style>
