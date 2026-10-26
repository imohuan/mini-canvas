<script setup lang="ts">
/**
 * NodeSelectOverlay —— **通用的节点选择态覆盖层**（over:inset 挂载，长在节点里跟随变换）。
 *
 * 用户口径（2026-10-26）：Ctrl 拖选择态与参考选择态的覆盖层效果完全一样，
 * 抽象成一个通用组件 —— 两种模式只是"操作方式"不同（拖拽 vs 点击），
 * 面孔/角标/提醒/灰罩共用同一套。
 *
 * - mode='reference'：**点击**节点连上/取消；已连接悬停提醒"取消选择 图片N"。
 * - mode='ctrl-drag'：从节点**按住拖拽**到参考格替换；已连接提醒"已连接 · 不可重复拖拽"。
 *
 * 状态读 globalThis（两个会话都同步写）：跨模块实例（热重载 UMD 拷贝 vs bundle 拷贝）
 * 的模块 ref 不共享，靠 enter/exit 广播的事件 + tick 计数驱动重算。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import {
  referenceNodeState,
  referenceHintText,
  canReference,
  type NodeTypeLike,
  type ReferenceNodeState,
} from './referenceMode'
import { nodeMediaOf } from './refSlotDrag'
import { requestStartDrag } from './ctrlDragMode'

const props = defineProps<{
  id: string
  data: Record<string, unknown>
  /** 选择态种类：reference=点击连/断；ctrl-drag=按住拖拽替换 */
  mode: 'reference' | 'ctrl-drag'
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

const { ctx } = useCanvasRender()

/** 会话开关的全局事件驱动重算（globalThis 不是响应源，无 tick 触发 computed 永不重算） */
const tick = ref(0)
const FLAG = (m: 'reference' | 'ctrl-drag') =>
  m === 'reference' ? '__miniCanvasRefSel' : '__miniCanvasCtrlDrag'
const EVENT = (m: 'reference' | 'ctrl-drag') =>
  m === 'reference' ? 'mini-canvas:reference-mode' : 'mini-canvas:ctrl-drag-mode'

function readSession(): { active: boolean; owner: string } {
  const key = FLAG(props.mode) as 'reference' | 'ctrl-drag'
  const s = (globalThis as Record<string, { active: boolean; owner: string } | undefined>)[key]
  return s?.active ? { active: true, owner: s.owner } : { active: false, owner: '' }
}
function onModeChange(): void {
  tick.value += 1
}
onMounted(() => window.addEventListener(EVENT(props.mode), onModeChange))
onBeforeUnmount(() => window.removeEventListener(EVENT(props.mode), onModeChange))
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
  const session = readSession()
  if (!session.active) return null
  const d = ctx.tryGet<DocLike>('doc')
  if (!d) return null
  const node = d.getNode(props.id)
  if (!node) return null
  const ownerNode = d.getNode(session.owner)
  const ownerType = d.types.get(ownerNode?.type ?? '') as NodeTypeLike | undefined
  const nodeType = d.types.get(node.type ?? '') as NodeTypeLike | undefined
  // ctrl-drag 模式只认媒体节点（音频/视频/图片）；reference 沿用 canReference 判定
  const canUse = props.mode === 'ctrl-drag' ? !!nodeMediaOf(node) : canReference(nodeType, ownerType)
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

const hint = computed(() => {
  if (!state.value || state.value === 'owner' || state.value === 'blocked') return ''
  if (props.mode === 'ctrl-drag') {
    if (state.value === 'connected') return '已连接 · 不可重复拖拽'
    return ''
  }
  const label = (props.data?.label as string) || props.id
  return referenceHintText(state.value, label)
})

/** 点击行为（仅 reference 模式）：连上/取消；ctrl-drag 模式点击不动作（操作是拖拽） */
function onPick(): void {
  if (props.mode !== 'reference') return
  const session = readSession()
  if (!session.active) return
  if (!state.value || state.value === 'owner' || state.value === 'blocked') return
  const d = ctx.tryGet<DocLike>('doc')
  if (!d) return
  if (state.value === 'selectable') {
    d.connectEdge({ source: props.id, target: session.owner })
    return
  }
  const ids = d
    .getEdges()
    .filter((e) => e.source === props.id && e.target === session.owner)
    .map((e) => e.id)
  if (ids.length > 0) d.removeEdges(ids)
}

/**
 * pointerdown 捕获：ctrl-drag 模式发起拖拽并 stop（防节点选中误触）；
 * reference 模式直接放行（点击 = 连/断，stop 会吞掉后续 click）。
 */
function onDragPointerDown(ev: PointerEvent): void {
  if (props.mode !== 'ctrl-drag') return
  const session = readSession()
  if (!session.active) return
  requestStartDrag(props.id, ev)
  ev.preventDefault()
  ev.stopPropagation()
}
</script>

<template>
  <div
    v-if="state"
    ref="rootEl"
    class="nso-layer"
    :class="['is-' + state, 'is-' + mode]"
    :style="{ border: border.width + ' ' + border.style + ' ' + border.color, borderRadius: radius }"
    data-testid="node-select-layer"
    @pointerdown.capture="onDragPointerDown($event)"
    @click.stop="onPick()"
  >
    <span v-if="state === 'selectable'" class="nso-badge">
      {{ state === 'connected' ? '✓' : '+' }}
    </span>
    <span v-if="hint" class="nso-hint" :class="{ 'is-connected': state === 'connected' }">{{ hint }}</span>
  </div>
</template>

<style scoped>
/* 通用面孔（两种模式一致）：紫描边/淡紫底/角标/灰罩，走 --ui-* token */
.nso-layer { position: absolute; inset: 0; border-radius: inherit;
  /* 父容器 .v2-overlay 是 pointer-events:none（BaseNode 红线文件）——
     不显式设 auto 的话本层点击/拖拽会全部穿透到节点（真机踩过）。 */
  pointer-events: auto; }
.nso-layer.is-reference { cursor: pointer; }
.nso-layer.is-ctrl-drag { cursor: grab; }
.nso-layer.is-selectable { background: transparent; }
.nso-layer.is-reference.is-selectable:hover { background: color-mix(in srgb, var(--ui-accent) 14%, transparent); }
.nso-layer.is-connected { background: color-mix(in srgb, var(--ui-accent) 10%, transparent); }
.nso-layer.is-owner { pointer-events: none; }
.nso-layer.is-blocked { background: color-mix(in srgb, var(--ui-scrim) 42%, transparent); pointer-events: none; }
.nso-badge { position: absolute; left: 6px; top: 6px; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-accent); color: var(--ui-primary-ink, #fff); font-size: 12px; font-weight: 700; line-height: 1; }
.nso-hint { position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%); padding: 4px 10px; border-radius: 8px; background: var(--ui-tip); color: var(--ui-tip-ink); font-size: 12px; font-weight: 600; white-space: nowrap; z-index: 71; }
.nso-hint.is-connected { background: var(--ui-accent); color: var(--ui-primary-ink, #fff); }
</style>
