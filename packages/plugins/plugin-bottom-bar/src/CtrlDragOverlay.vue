<script setup lang="ts">
/**
 * CtrlDragOverlay —— Ctrl 选择态的**顶部操作栏 + Esc 提示**（fixed 浮层）。
 *
 * 节点高亮已移到 NodeCtrlDragOverlay（挂节点 over:inset，跟随缩放/平移）。
 * 本组件只负责顶部操作栏（提示/关闭）与底部 Esc 提示。
 *
 * 状态读 globalThis.__miniCanvasCtrlDrag：发起方（底栏，热重载 UMD 拷贝）与
 * 本组件（bundle 拷贝）可能不是同一模块实例 —— 模块 ref 不共享，
 * enter/exit 会同步写 globalThis 并广播 mini-canvas:ctrl-drag-mode 事件。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { computed } from 'vue'
import { useCanvasRender, RenderEvents } from '@mini-canvas/canvas-render'
import { ctrlDragNodeState, ctrlDragHintText, type CtrlDragNodeState } from './ctrlDragMode'
import { nodeMediaOf } from './refSlotDrag'

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

function readActive(): boolean {
  return !!(globalThis as { __miniCanvasCtrlDrag?: { active: boolean } }).__miniCanvasCtrlDrag?.active
}

const active = ref(readActive())
function syncActive(): void {
  active.value = readActive()
}

interface NodeLayer {
  id: string
  state: CtrlDragNodeState
  hint: string
  rect: { x: number; y: number; w: number; h: number }
}
const { ctx, flow } = useCanvasRender()
const layers = ref<NodeLayer[]>([])

function measure(next: NodeLayer[]): void {
  next.length = 0
  const owner = (globalThis as { __miniCanvasCtrlDrag?: { active: boolean; owner: string } }).__miniCanvasCtrlDrag
  if (!active.value || !owner?.active || !owner.owner) return
  const d = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined; getEdges(): Array<{ source: string; target: string }>; getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }> }>('doc')
  if (!d) return
  const incoming = new Set(d.getEdges().filter((e) => e.target === owner.owner).map((e) => e.source))
  for (const node of d.getNodes()) {
    const el = flow.queryNodeEl(node.id)
    const target = (el?.querySelector('.v2-card') as HTMLElement | null) ?? el
    if (!target) continue
    const b = target.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) continue
    const isMedia = !!nodeMediaOf(node)
    const state = ctrlDragNodeState({ isOwner: node.id === owner.owner, isMedia, connected: incoming.has(node.id) })
    const label = node.data?.label
    const title = typeof label === 'string' && label.trim() ? label : node.id
    next.push({ id: node.id, state, hint: ctrlDragHintText(state, title), rect: { x: b.left, y: b.top, w: b.width, h: b.height } })
  }
}

function sameLayers(a: NodeLayer[], b: NodeLayer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    if (x.id !== y.id || x.state !== y.state || x.hint !== y.hint || x.rect.x !== y.rect.x || x.rect.y !== y.rect.y || x.rect.w !== y.rect.w || x.rect.h !== y.rect.h) return false
  }
  return true
}

function refresh(): void {
  const scratch: NodeLayer[] = []
  measure(scratch)
  if (sameLayers(layers.value, scratch)) return
  layers.value = scratch
}

const hoverId = ref<string | null>(null)

onMounted(() => {
  window.addEventListener('mini-canvas:ctrl-drag-mode', syncActive)
  const timer = window.setInterval(() => {
    refresh()
  }, 200)
  ;(window as unknown as { __ctrlDragCleanup?: () => void }).__ctrlDragCleanup = () => window.clearInterval(timer)
})
onBeforeUnmount(() => {
  window.removeEventListener('mini-canvas:ctrl-drag-mode', syncActive)
  ;(window as unknown as { __ctrlDragCleanup?: () => void }).__ctrlDragCleanup?.()
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
      <div
        v-for="layer in layers"
        :key="layer.id"
        class="cd-layer"
        :class="['is-' + layer.state, { 'is-hover': hoverId === layer.id }]"
        :style="{ left: layer.rect.x + 'px', top: layer.rect.y + 'px', width: layer.rect.w + 'px', height: layer.rect.h + 'px' }"
        :data-state="layer.state"
        @pointerenter="hoverId = layer.id"
        @pointerleave="hoverId = null"
      >
        <span v-if="layer.state === 'selectable' || layer.state === 'connected'" class="cd-badge">
          {{ layer.state === 'connected' ? '✓' : '+' }}
        </span>
        <span v-if="layer.hint && hoverId === layer.id" class="cd-hint" :class="{ 'is-connected': layer.state === 'connected' }" :style="{ left: (layer.rect.x + 14) + 'px', top: (layer.rect.y + layer.rect.h + 8) + 'px' }">
          {{ layer.hint }}
        </span>
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
.cd-layer { position: fixed; border-radius: 12px; pointer-events: none; transition: background-color .15s ease-out, box-shadow .15s ease-out; }
.cd-layer.is-selectable { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.cd-layer.is-selectable.is-hover { background: color-mix(in srgb, var(--ui-accent) 14%, transparent); box-shadow: inset 0 0 0 2px var(--ui-accent); }
.cd-layer.is-connected { background: color-mix(in srgb, var(--ui-accent) 10%, transparent); box-shadow: inset 0 0 0 1.5px var(--ui-accent); }
.cd-layer.is-blocked { background: color-mix(in srgb, var(--ui-scrim) 42%, transparent); }
.cd-layer.is-owner { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 40%, transparent); }
.cd-badge { position: absolute; left: 6px; top: 6px; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 700; line-height: 1; }
.cd-hint { position: fixed; padding: 5px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; z-index: 71; }
.cd-hint.is-connected { background: var(--ui-accent); color: var(--ui-tip-ink); }
.cd-esc-key { font-weight: 700; }
</style>
