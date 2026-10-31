<script setup lang="ts">
/**
 * NodeSelectOverlay —— 选择态的**唯一**节点覆盖层（over:inset 挂载，长在节点里跟随变换）。
 *
 * 用户口径（2026-10-28）：参考选择与 Ctrl 拖拽本来就是同一套，只有操作方式和文字不同。
 * 所以不再按 mode 注册两份，只读统一会话：
 *   - 参考模式：点击节点 = 连上/取消；
 *   - Ctrl 拖拽：按住节点拖到参考格替换；
 *   - 松开 Ctrl 若仍开着参考，自动回到参考。
 *
 * blocked 的红层也**必须接鼠标**（用户 2026-10-28：红色禁用节点 hover 也要出提示）。
 * 做法是接指针但不接动作：点击/拖拽进来都会被忽略，只有悬停提示生效。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import {
  referenceNodeState,
  canReference,
  selectionNodeHint,
  type NodeTypeLike,
  type ReferenceNodeState,
} from './referenceMode'
import { nodeMediaOf } from './refSlotDrag'
import { requestStartDrag } from './ctrlDragMode'
import { readSelectionSnapshot, selectionMode } from './selectionMode'
const { ctx } = useCanvasRender()
/**
 * 提示走画布动作门面的 canvas.notify（followPointer = 跟随鼠标）。
 * 本插件不再自绘气泡 —— 位置/观感由渲染层统一（鼠标右下角、无间隔）。
 */
function tipService(): { notify(m: string, o?: object): unknown } | undefined {
  return ctx.tryGet<{ notify(m: string, o?: object): unknown }>('canvas')
}

const props = defineProps<{
  id: string
  data: Record<string, unknown>
  /** 边框配置项（缺省 = BaseNode 选中态同款） */
  borderColor?: string
  borderStyle?: string
  borderWidth?: string
}>()

/**
 * 边框外观配置项（用户口径：复用 BaseNode 原生边框效果 + 可配置颜色/样式）。
 * 默认值 = BaseNode 选中态的同款 token（--canvas-node-border-selected / 1px 实线），
 * 宿主可通过 props 覆盖单个字段。
 */
const border = computed(() => ({
  /* 用户口径（2026-10-26）：边框颜色用主题色（当前设置的紫色），不是默认灰 */
  color: props.borderColor ?? 'var(--ui-accent, #7c3aed)',
  style: props.borderStyle ?? 'solid',
  width: props.borderWidth ?? '1px',
}))

/** 统一会话变化时 +1（globalThis 不是响应源，无 tick 触发 computed 永不重算） */
const tick = ref(0)
function onModeChange(): void {
  tick.value += 1
}
onMounted(() => window.addEventListener('mini-canvas:selection-mode', onModeChange))
onBeforeUnmount(() => window.removeEventListener('mini-canvas:selection-mode', onModeChange))
onMounted(() => {
  syncRadius()
  radiusTimer = setInterval(syncRadius, 250)
})
onBeforeUnmount(() => {
  if (radiusTimer) clearInterval(radiusTimer)
})

type DocLike = {
  getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
  getEdges(): Array<{ id: string; source: string; target: string }>
  types: { get(type: string): NodeTypeLike | undefined }
  connectEdge(input: { source: string; target: string }): unknown
  removeEdges(ids: string[]): number
}

const state = computed<null | ReferenceNodeState>(() => {
  void tick.value
  const session = readSelectionSnapshot()
  if (!session.mode) return null
  const d = ctx.tryGet<DocLike>('doc')
  if (!d) return null
  const node = d.getNode(props.id)
  if (!node) return null
  const ownerNode = d.getNode(session.owner)
  const ownerType = d.types.get(ownerNode?.type ?? '') as NodeTypeLike | undefined
  const nodeType = d.types.get(node.type ?? '') as NodeTypeLike | undefined
  /**
   * 两种模式共用「能连进来」的判定：文本节点产出 text（PortDef 已声明），
   * 所以文本一直可选、也可拖（拖到文本格）。
   */
  const canUse = canReference(nodeType, ownerType)
  const connected = d.getEdges().some((e) => e.source === props.id && e.target === session.owner)
  return referenceNodeState({ isOwner: props.id === session.owner, canReference: canUse, connected })
})

/** 圆角跟随卡片实算值（over:inset 容器是方角，inherit 拿到 0 —— 真机踩过） */
const rootEl = ref<HTMLElement | null>(null)
const radius = ref('8px')
let radiusTimer: ReturnType<typeof setInterval> | null = null
function syncRadius(): void {
  const cardEl = rootEl.value?.closest('.v2-node')?.querySelector('.v2-card') as HTMLElement | null
  if (!cardEl) return
  const r = getComputedStyle(cardEl).borderRadius
  if (r && r !== radius.value) radius.value = r
}

const hintText = computed(() => {
  const mode = readSelectionSnapshot().mode
  if (!mode || !state.value) return ''
  const label = (props.data?.label as string) || props.id
  return selectionNodeHint(mode, state.value, label)
})

/** 悬停：显示通用鼠标提示（用户口径：底部文字标签不要，改成跟随鼠标的提示） */
function onEnter(): void {
  if (hintText.value) {
    tipService()?.notify(hintText.value, { source: 'bottom-bar', followPointer: true, durationMs: 0 })
  }
}
function onLeave(): void {
  tipService()?.notify('', { source: 'bottom-bar' })
}

/** 点击行为（仅 reference 模式）：连上/取消；ctrl-drag 模式点击不动作（操作是拖拽） */
function onPick(): void {
  if (selectionMode() !== 'reference') return
  const session = readSelectionSnapshot()
  if (!session.mode) return
  if (!state.value || state.value === 'owner' || state.value === 'blocked') return
  const d = ctx.tryGet<DocLike>('doc')
  if (!d) return
  if (state.value === 'selectable') {
    d.connectEdge({ source: props.id, target: session.owner })
    // 连上后要刷新本层（以及其它层）的面孔 —— 否则 state 停留在 selectable，
    // 再点一次会重复走 connect 分支（用户看到的"第二次点击没取消"就是这个）。
    onModeChange()
    return
  }
  const ids = d
    .getEdges()
    .filter((e) => e.source === props.id && e.target === session.owner)
    .map((e) => e.id)
  if (ids.length > 0) d.removeEdges(ids)
  onModeChange()
}

/**
 * pointerdown 捕获：ctrl-drag 模式发起拖拽并 stop（防节点选中误触）；
 * reference 模式直接放行（点击 = 连/断，stop 会吞掉后续 click）。
 */
function onDragPointerDown(ev: PointerEvent): void {
  if (selectionMode() !== 'ctrl-drag') return
  const session = readSelectionSnapshot()
  if (!session.mode) return
  // blocked / owner 一律不发拖拽（红层只负责提示）
  if (state.value !== 'selectable' && state.value !== 'connected') return
  if (state.value === 'connected') return
  requestStartDrag(props.id, ev)
  ev.preventDefault()
  ev.stopPropagation()
}

/** 拖拽模式下这个节点是否真的能拖（有文本/图片/视频/音频内容） */
const canDragNode = computed(() => {
  if (readSelectionSnapshot().mode !== 'ctrl-drag') return false
  const d = ctx.tryGet<DocLike>('doc')
  return !!nodeMediaOf(d?.getNode(props.id))
})
</script>

<template>
  <div
    v-if="state"
    ref="rootEl"
    class="nso-layer"
    :class="['is-' + state, selectionMode() ? 'is-' + selectionMode() : '']"
    :style="{ border: border.width + ' ' + border.style + ' ' + border.color, borderRadius: radius }"
    data-testid="node-select-layer"
    @pointerdown.capture="onDragPointerDown($event)"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @click.stop="onPick()"
  >
    <span v-if="state === 'connected'" class="nso-badge">✓</span>
    <span v-else-if="state === 'selectable'" class="nso-badge">+</span>
    <span v-else-if="state === 'blocked'" class="nso-badge" aria-hidden="true">
      <!-- 禁用图标（🚫）：圆 + 斜杠，与 + / ✓ 同一套左上角角标位 -->
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="5.8" y1="5.8" x2="18.2" y2="18.2" />
      </svg>
    </span>
    <!-- 拖拽模式：可拖的节点右下角给一个小圆点（文字仍走 tip） -->
    <span v-if="state !== 'owner' && canDragNode" class="nso-drag-dot" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* 通用面孔（两种模式一致）：主题色描边/蒙版/角标，blocked 用红色蒙版 + 禁用角标（2026-10-27 用户定稿，demo docs/tmp/node-select-overlay-demo.html） */
.nso-layer { position: absolute; inset: 0; border-radius: inherit;
  /* 父容器 .v2-overlay 是 pointer-events:none（BaseNode 红线文件）——
     不显式设 auto 的话本层点击/拖拽会全部穿透到节点（真机踩过）。 */
  pointer-events: auto; }
.nso-layer.is-reference { cursor: pointer; }
.nso-layer.is-ctrl-drag { cursor: grab; }
.nso-layer.is-selectable { background: color-mix(in srgb, var(--ui-accent) 2%, transparent); }
.nso-layer.is-selectable:hover { background: color-mix(in srgb, var(--ui-accent) 12%, transparent); }
.nso-layer.is-connected { background: color-mix(in srgb, var(--ui-accent) 20%, transparent); }
.nso-layer.is-connected:hover { background: color-mix(in srgb, var(--ui-accent) 30%, transparent); }
.nso-layer.is-owner { pointer-events: none; }
/* 主题色白名单: 红色语义 = 危险/禁用，走 --ui-danger（形状为蒙版与角标，非主题强调色）。
   blocked 仍然接指针：用户 2026-10-28 要求红色禁用节点 hover 也要有提示；
   动作本身由 pointerdown / click 里的 state 判断拦住（blocked 一律不响应）。 */
.nso-layer.is-blocked { border-color: var(--ui-danger); background: color-mix(in srgb, var(--ui-danger) 16%, transparent); cursor: help; }
.nso-badge { position: absolute; left: 6px; top: 6px; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 700; line-height: 1; }
.nso-layer.is-blocked .nso-badge { background: var(--ui-danger); }
/* 拖拽模式下可拖节点的右下角小圆点（不引入第二种强调色） */
.nso-drag-dot {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-accent);
  opacity: 0.75;
  pointer-events: none;
}
</style>
