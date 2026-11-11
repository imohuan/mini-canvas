<script setup lang="ts">
/**
 * StyleLibraryOverlay —— 风格库的**弹窗外壳**（画布模式下使用）。
 *
 * 它只做外壳：Teleport 到 body + 遮罩 + 居中面板 + 标题栏（✕ / 最小化）。
 * 内容在 StyleLibraryContent.vue：项目页的「风格库」页签用同一个内容组件，
 * 但不套这层弹窗 —— 没有遮罩、没有圆角卡片、没有展开动画。
 *
 * 显隐看服务的 state.open：命令 / 面板按钮打开 → 显示；加入成功或点 ✕ / Esc → 关闭。
 */
import { computed, onBeforeUnmount, onMounted, ref, Teleport, watch } from 'vue'
import { X, Minus } from 'lucide-vue-next'
import { useCanvasContextOrRender } from '@plume-canvas/canvas-render'
import type { LibraryService } from '../data/store'
import StyleLibraryContent from './StyleLibraryContent.vue'

/**
 * 根节点是 Teleport：槽宿主传下来的 class / data-slot-* 无处可落。
 * 显式声明不继承，避免 Vue 报「Extraneous non-props attributes」。
 */
defineOptions({ inheritAttrs: false })

// 宽松取件：本浮层注册在画布 overlay 槽里（CanvasSurface 只 provide 渲染上下文）。
const { ctx } = useCanvasContextOrRender()
const svc = ctx.get<LibraryService>('style-library')
const s = svc.state

/** 最小化：只收起面板（不关，保留状态） */
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

// 关闭时收起最小化态，下次打开是干净的面板
watch(
  () => s.open,
  (v) => {
    if (!v) minimized.value = false
  },
)

/** 加入画布成功：浮层任务完成，关掉自己（项目页页签不会收到这个动作）。 */
function onUsed(): void {
  svc.close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="slol-layer" @pointerdown.self="svc.close()" @contextmenu.prevent>
      <div class="slol-panel" @pointerdown.stop>
        <header class="slol-head">
          <h3 class="slol-title">素材库 · 风格广场</h3>
          <div class="slol-head-actions">
            <button class="slol-icon" type="button" aria-label="最小化" title="最小化" @click="minimized = true">
              <Minus :size="16" />
            </button>
            <button class="slol-icon" type="button" aria-label="关闭风格库" title="关闭" @click="svc.close()">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="slol-body">
          <StyleLibraryContent @used="onUsed" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.slol-layer {
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
.slol-panel {
  display: flex;
  flex-direction: column;
  width: min(1280px, 100%);
  height: min(86vh, 860px);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: 16px;
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.2));
  overflow: hidden;
  animation: slol-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes slol-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}
.slol-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 10px 10px 10px 18px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.slol-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--ui-ink, #18202b); }
.slol-head-actions { display: flex; gap: 4px; }
.slol-icon {
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
.slol-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.slol-icon:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.slol-body { flex: 1; min-height: 0; display: flex; }

@media (prefers-reduced-motion: reduce) {
  .slol-panel, .slol-icon { transition: none !important; animation: none !important; }
}
</style>
