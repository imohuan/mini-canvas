<script setup lang="ts">
/**
 * CtrlDragOverlay —— Ctrl 按住时的**画布拖拽选择态**浮层（视觉复刻 ReferenceSelectOverlay）。
 *
 * 与参考选择的差异：参考选择是"点击连/断"，这里是"按住拖到参考格替换"。
 * 可拖的资源节点：紫描边 + 加号角标；已连接：淡紫底 + 勾角标 + 悬停提醒（禁止重复拖）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender, RenderEvents } from '@mini-canvas/canvas-render'
import {
  ctrlDragActive,
  ctrlDragEpoch,
  ctrlDragHintText,
  ctrlDragNodeState,
  ctrlDragOwner,
  type CtrlDragNodeState,
} from './ctrlDragMode'
import { nodeMediaOf } from './refSlotDrag'

interface NodeLayer {
  id: string
  title: string
  state: CtrlDragNodeState
  hint: string
  rect: { x: number; y: number; w: number; h: number }
}

const { ctx, flow } = useCanvasRender()

const layers = ref<NodeLayer[]>([])
const hoverId = ref<string | null>(null)
const hovered = computed(() => layers.value.find((l) => l.id === hoverId.value && (l.state === 'selectable' || l.state === 'connected')) ?? null)
const hintPos = ref({ x: 0, y: 0 })
const HINT_OFFSET = { x: 14, y: 18 }

function onPointerMove(e: PointerEvent): void {
  hintPos.value = { x: e.clientX, y: e.clientY }
}

const active = computed(() => ctrlDragActive())

function measure(next: NodeLayer[]): void {
  next.length = 0
  const owner = ctrlDragOwner()
  if (!active.value || !owner) return
  const d = ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined; getEdges(): Array<{ source: string; target: string }>; getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }> }>('doc')
  if (!d) return
  const incoming = new Set(d.getEdges().filter((e) => e.target === owner).map((e) => e.source))
  for (const node of d.getNodes()) {
    const el = flow.queryNodeEl(node.id)
    const target = (el?.querySelector('.v2-card') as HTMLElement | null) ?? el
    if (!target) continue
    const b = target.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) continue
    const label = node.data?.label
    const title = typeof label === 'string' && label.trim() ? label : node.id
    const isMedia = !!nodeMediaOf(node)
    const state = ctrlDragNodeState({ isOwner: node.id === owner, isMedia, connected: incoming.has(node.id) })
    next.push({ id: node.id, title, state, hint: ctrlDragHintText(state, title), rect: { x: b.left, y: b.top, w: b.width, h: b.height } })
  }
}

function sameLayers(a: NodeLayer[], b: NodeLayer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    if (x.id !== y.id || x.state !== y.state || x.hint !== y.hint || x.title !== y.title || x.rect.x !== y.rect.x || x.rect.y !== y.rect.y || x.rect.w !== y.rect.w || x.rect.h !== y.rect.h) return false
  }
  return true
}

function refresh(): void {
  const scratch: NodeLayer[] = []
  measure(scratch)
  if (sameLayers(layers.value, scratch)) return
  layers.value = scratch
}

function onKeydown(e: KeyboardEvent): void {
  if (!active.value) return
  if (e.key === 'Escape') exitCtrl()
}
function exitCtrl(): void {
  import('./ctrlDragMode').then((m) => m.exitCtrlDragMode())
}

const epoch = ref(ctrlDragEpoch())

let rafId = 0
onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  rafId = requestAnimationFrame(function loop() {
    refresh()
    rafId = requestAnimationFrame(loop)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('pointermove', onPointerMove)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="cd-root" :data-epoch="epoch" data-testid="ctrl-drag-overlay">
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
        <span v-if="layer.state === 'selectable' || layer.state === 'connected'" class="cd-badge" aria-hidden="true">
          {{ layer.state === 'connected' ? '✓' : '+' }}
        </span>
      </div>
      <span
        v-if="hovered && hovered.hint"
        class="cd-hint"
        :class="{ 'is-connected': hovered.state === 'connected' }"
        :style="{ left: hintPos.x + HINT_OFFSET.x + 'px', top: hintPos.y + HINT_OFFSET.y + 'px' }"
      >
        {{ hovered.hint }}
      </span>
      <div class="cd-esc">
        <span class="cd-esc-key">ESC</span>
        <span>按 Esc 退出</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 面孔与 ReferenceSelectOverlay（rs-）同构：紫描边/淡紫底/灰罩，全部走 --ui-* token */
.cd-root { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
.cd-layer { position: fixed; border-radius: 12px; pointer-events: none; transition: background-color .15s ease-out, box-shadow .15s ease-out; }
.cd-layer.is-selectable { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.cd-layer.is-selectable.is-hover { background: color-mix(in srgb, var(--ui-accent) 14%, transparent); box-shadow: inset 0 0 0 2px var(--ui-accent); }
.cd-layer.is-connected { background: color-mix(in srgb, var(--ui-accent) 10%, transparent); box-shadow: inset 0 0 0 1.5px var(--ui-accent); }
.cd-layer.is-blocked { background: color-mix(in srgb, var(--ui-scrim) 42%, transparent); }
.cd-layer.is-owner { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 40%, transparent); }
.cd-badge { position: absolute; left: 6px; top: 6px; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 700; line-height: 1; }
.cd-hint { position: fixed; padding: 5px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; will-change: transform; }
.cd-hint.is-connected { background: var(--ui-accent); color: var(--ui-tip-ink); }
.cd-esc { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; }
.cd-esc-key { font-weight: 700; }
</style>
