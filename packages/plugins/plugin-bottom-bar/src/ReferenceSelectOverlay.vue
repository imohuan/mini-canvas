<script setup lang="ts">
/**
 * 根节点是 Teleport：插槽宿主（SlotHost）下发的 class/data-slot-* 继承不了，
 * 不关掉属性继承 Vue 每次渲染都会警告一次（实测刷屏）。我们本来就不用那些属性。
 */
defineOptions({ inheritAttrs: false })
/**
 * ReferenceSelectOverlay —— 底栏「参考」按钮引发的**画布选择态**浮层（注册在 overlay 槽）。
 *
 * 用户要的交互（照 LibTV 参考站实测 + 用户口述）：
 * 1. 进选择态后**顶上浮出一条操作框**（提示 + 返回节点 + 关闭）；
 * 2. 画布上的节点里，只有能被当前节点接收的那些**可点**（悬停出提示），其余灰掉；
 * 3. 点一个可选节点 = 建立链接（它随即作为素材出现在底栏的素材区里）；再点一下取消；
 * 4. Esc / 关闭 / 「返回节点」都能退出。
 *
 * 定位手法与 NodeBottomBarOverlay 完全一致（Teleport 到 body + 屏幕坐标 fixed）：
 * 节点带 transform 必然成层叠上下文，浮层留在画布/节点里会被外壳 UI 压住或裁掉。
 *
 * 判定（谁能当参考、该显示什么面孔、点一下做什么）全在 referenceMode.ts 的纯函数里，
 * 本文件只管「量矩形、摆位置、转交点击」。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, RenderEvents } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import {
  exitReference,
  focusViewportFor,
  referenceActive,
  referenceEpoch,
  referenceHintText,
  referenceNodeState,
  referenceOwner,
  referencePickAction,
  canReference,
  type NodeTypeLike,
  type ReferenceNodeState,
} from './referenceMode'

/** 提示胶囊跟随鼠标时与光标的偏移（px）：往右下让开一点，不挡光标也不挡节点）
 *  （与参考站实测一致：胶囊落在光标右下角外侧） */
const HINT_OFFSET = { x: 14, y: 18 }

const { ctx, flow } = useCanvasRender()

/** 一个节点在选择态里的渲染项（矩形是屏幕坐标，fixed 定位用） */
interface NodeLayer {
  id: string
  title: string
  state: ReferenceNodeState
  hint: string
  rect: { x: number; y: number; w: number; h: number }
}

const layers = ref<NodeLayer[]>([])
/** 悬停高亮的节点 id（只对可点的那些有意义） */
const hoverId = ref<string | null>(null)
/** 当前悬停的那个"可点"节点（提示胶囊要显示谁的那句话） */
const hovered = computed(
  () =>
    layers.value.find(
      (l) => l.id === hoverId.value && (l.state === 'selectable' || l.state === 'connected'),
    ) ?? null,
)
/** 悬停提示跟随鼠标的屏幕坐标（用户要求：提示跟着鼠标走、保持偏移，而不是钉在节点上） */
const hintPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })

/**
 * 鼠标移动时记下位置（提示胶囊据此跟随；只在有悬停时才有意义）。
 * 监听挂在 window 上：鼠标掠过节点时事件仍会冒泡到 window，不必逐层绑。
 */
function onPointerMove(e: PointerEvent): void {
  hintPos.value = { x: e.clientX, y: e.clientY }
}

const active = computed(() => referenceActive())
const epoch = ref(referenceEpoch())
watchEpoch()
function watchEpoch(): void {
  // 会话状态是 module 级 ref：用 watch 跟随，进入新一次选择态时清掉悬停高亮
  watch(referenceEpoch, (v) => {
    epoch.value = v
    hoverId.value = null
  })
}

/** 顶栏那句提示 */
const TOP_TEXT = '从画布或资产管理选择参考'

function doc(): DocService | undefined {
  return ctx.tryGet<DocService>('doc')
}

/** 节点显示名（有自定义标题用标题，否则用类型名） */
function titleOf(id: string): string {
  const d = doc()
  const node = d?.getNode(id)
  if (!node) return id
  const label = node.data?.label
  if (typeof label === 'string' && label.trim()) return label
  return d?.types.get(node.type)?.label || node.type
}

/**
 * 重算每个节点的面孔与矩形。
 * 逐帧调用（拖动/缩放/平移都要跟），只在真的变了才写 ref —— 否则每帧都全量重渲染。
 */
function measure(next: NodeLayer[]): void {
  const d = doc()
  const owner = referenceOwner()
  next.length = 0
  if (!active.value || !owner || !d) return
  const ownerType = d.types.get(d.getNode(owner)?.type ?? '') as NodeTypeLike | undefined
  const incoming = new Set(d.getEdges().filter((e) => e.target === owner).map((e) => e.source))

  for (const node of d.getNodes()) {
    const el = flow.queryNodeEl(node.id)
    const target = (el?.querySelector('.v2-card') as HTMLElement | null) ?? el
    if (!target) continue
    const b = target.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) continue
    const ok = canReference(d.types.get(node.type) as NodeTypeLike | undefined, ownerType)
    const connected = incoming.has(node.id)
    const state = referenceNodeState({ isOwner: node.id === owner, canReference: ok, connected })
    const t = titleOf(node.id)
    next.push({
      id: node.id,
      title: t,
      state,
      hint: referenceHintText(state, t),
      rect: { x: b.left, y: b.top, w: b.width, h: b.height },
    })
  }
}

/** 层与上一帧是否完全一致（避免每帧重建数组触发重渲染） */
function sameLayers(a: NodeLayer[], b: NodeLayer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.state !== y.state ||
      x.hint !== y.hint ||
      x.title !== y.title ||
      x.rect.x !== y.rect.x ||
      x.rect.y !== y.rect.y ||
      x.rect.w !== y.rect.w ||
      x.rect.h !== y.rect.h
    ) {
      return false
    }
  }
  return true
}

/** 变了才写 ref 的一拍 */
function refresh(): void {
  const scratch: NodeLayer[] = []
  measure(scratch)
  if (sameLayers(layers.value, scratch)) return
  layers.value = scratch
}

// 点击节点：连上 / 取消 —— 决策在纯函数里，这里只落地
function onPick(layer: NodeLayer): void {
  const d = doc()
  const owner = referenceOwner()
  if (!d || !owner) return
  // 灰掉的节点只是盖层（不可点）；双保险：即使事件漏进来也不动任何东西
  if (layer.state === 'blocked' || layer.state === 'owner') return
  const action = referencePickAction(layer.state)
  if (action === 'none') return
  if (action === 'connect') {
    d.connectEdge({ source: layer.id, target: owner })
    return
  }
  // disconnect：只摘掉「这个节点 → 当前节点」的边
  const ids = d
    .getEdges()
    .filter((e) => e.source === layer.id && e.target === owner)
    .map((e) => e.id)
  if (ids.length > 0) d.removeEdges(ids)
}

function onKeydown(e: KeyboardEvent): void {
  if (!active.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    exitReference()
  }
}

/** 「返回节点」：把视口聚焦回宿主节点（用户要求：点它有个节点聚焦效果）。 */
function focusOwner(): void {
  const d = doc()
  const owner = referenceOwner()
  if (!d || !owner) return
  // 优先用 nodeLayout 的 flow 绝对矩形；宿主没装它时回落「量卡片 DOM + 反算 flow 坐标」，
  // 保证「返回节点」在任何宿主里都真的会动（量不到就什么都不做，不报错）。
  const layout = ctx.tryGet<
    { getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null } | undefined
  >('nodeLayout')
  let rect = layout?.getNodeRect(owner) ?? null
  if (!rect) {
    const el = flow.queryNodeEl(owner)
    const card = (el?.querySelector('.v2-card') as HTMLElement | null) ?? el
    const b = card?.getBoundingClientRect()
    const vp = flow.viewport.value
    if (b && vp && vp.zoom > 0) {
      rect = {
        x: (b.left - (flow.paneRect.value?.left ?? 0) - vp.x) / vp.zoom,
        y: (b.top - (flow.paneRect.value?.top ?? 0) - vp.y) / vp.zoom,
        w: b.width / vp.zoom,
        h: b.height / vp.zoom,
      }
    }
  }
  if (!rect) return
  const viewport = ctx.tryGet<{
    getViewport(): { x: number; y: number; zoom: number }
    setCenter(x: number, y: number, zoom?: number): void
  } | undefined>('viewport')
  if (!viewport) return
  const target = focusViewportFor(rect, viewport.getViewport().zoom)
  // setCenter 用 flow 坐标（与 nodeLayout 的绝对坐标同一坐标系），屏幕中心 = 平移补偿直接归零
  viewport.setCenter(target.x, target.y, target.zoom)
}

/** 顶栏「返回节点」：先聚焦回节点，再退出选择态 */
function onBackToNode(): void {
  focusOwner()
  exitReference()
}

/**
 * 选择态的宿主节点还在不在选中集里。
 *
 * 为什么必须守这条：宿主一旦被别的选中操作顶掉，底栏会切去渲染那个新节点，
 * 而选择态浮层还挂在旧宿主上 —— 用户看到的是「底栏换人了、盖层还留着」的错位画面。
 * 宿主一掉，选择态就收（幂等：不在选择态时不会触发主动退出）。
 */
function guardOwnerSelected(): void {
  if (!active.value) return
  const sel = ctx.tryGet<{ ids: ReadonlySet<string> } | undefined>('selection')
  const owner = referenceOwner()
  const stillThere = !!sel && !!owner && sel.ids.size === 1 && sel.ids.has(owner)
  if (!stillThere) exitReference()
}

const offs: Array<{ dispose(): void }> = []
let rafId = 0
onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  rafId = requestAnimationFrame(function loop() {
    guardOwnerSelected()
    rafId = requestAnimationFrame(loop)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('pointermove', onPointerMove)
  if (rafId) cancelAnimationFrame(rafId)
  for (const d of offs) d.dispose()
})
// 数据变化时立刻重算一次（rAF 之外，避免首帧闪空）
offs.push(ctx.on(RenderEvents.SelectionChange, refresh))
offs.push(ctx.on(RenderEvents.NodeDragEnd, refresh))

const ICON_TARGET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'
const ICON_BACK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>'
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="rs-root" :data-epoch="epoch" data-testid="reference-select-overlay">
      <!-- 顶部操作框（用户要的「形成一个操作框」） -->
      <div class="rs-top" @pointerdown.stop>
        <span class="rs-top-icon" aria-hidden="true" v-html="ICON_TARGET" />
        <span class="rs-top-text">{{ TOP_TEXT }}</span>
        <button class="rs-top-btn" type="button" title="聚焦回当前节点并退出选择" @click.stop="onBackToNode">
          <span class="rs-top-btn-icon" aria-hidden="true" v-html="ICON_BACK" />
          <span>返回节点</span>
        </button>
        <button
          class="rs-top-close"
          type="button"
          title="退出选择（Esc）"
          aria-label="退出选择"
          @click.stop="exitReference"
        >
          <span aria-hidden="true" v-html="ICON_CLOSE" />
        </button>
      </div>

      <!-- 节点高亮/点击已移到 NodeReferenceSelectOverlay（overlay 槽组件，长在节点里跟随变换） -->
      <span
        v-if="hovered && hovered.hint"
        class="rs-hint"
        :class="{ 'is-connected': hovered.state === 'connected' }"
        :style="{ left: hintPos.x + HINT_OFFSET.x + 'px', top: hintPos.y + HINT_OFFSET.y + 'px' }"
      >
        {{ hovered.hint }}
      </span>

      <!-- 底部提示：Esc 退出 -->
      <div class="rs-esc">
        <span class="rs-esc-key">取消 ESC</span>
        <span class="rs-esc-text">按 ESC 退出</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 本组件是「深色舞台上的蓝底操作框 + 节点盖层」，颜色语义仅有三种：
   强调色（可点/已连）、灰罩（不可点）、绿（已建立链接）。全部走 --ui-* token，
   个别必须定死的白字/绿标按 UI 规范打「主题色白名单」标记。 */

/* 根层铺满视口但不吃事件：每张节点盖层自己决定要不要收点击 */
.rs-root {
  position: fixed;
  inset: 0;
  /* 70 > 底栏浮层 60：顶栏不能被节点边框盖住，点击也不能穿透到节点（真机踩过） */
  z-index: 70;
  pointer-events: none;
}

/* —— 顶部操作框（照参考站：蓝底胶囊、圆角、居中） —— */
.rs-top {
  position: fixed;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 12px 0 16px;
  border-radius: 16px;
  background: var(--ui-accent);
  /* 主题色白名单: 蓝底操作框上的白色字/图标与蓝底成对，必须一起定死 */
  color: #ffffff;
  box-shadow: var(--ui-shadow-lg, 0 12px 32px rgb(15 23 42 / 0.28));
  pointer-events: auto;
}
.rs-top-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: none;
}
.rs-top-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
.rs-top-text {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.rs-top-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  /* 主题色白名单: 蓝底上的白色半透明按钮，白与蓝成对 */
  background: rgb(255 255 255 / 0.16);
  /* 主题色白名单: 同上 */
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.rs-top-btn:hover {
  /* 主题色白名单: 同上 */
  background: rgb(255 255 255 / 0.26);
}
.rs-top-btn-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
}
.rs-top-btn-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
.rs-top-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  /* 主题色白名单: 蓝底上的白色图标 */
  color: #ffffff;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.rs-top-close:hover {
  /* 主题色白名单: 同上 */
  background: rgb(255 255 255 / 0.2);
}
.rs-top-close :deep(svg) {
  width: 16px;
  height: 16px;
}
.rs-top-btn:focus-visible,
.rs-top-close:focus-visible {
  /* 主题色白名单: 蓝底上的白色焦点环 */
  outline: 2px solid rgb(255 255 255 / 0.8);
  outline-offset: 1px;
}

/* —— 节点盖层 —— */
.rs-layer {
  position: fixed;
  border-radius: 12px;
  pointer-events: none;
  transition: background-color 0.15s ease-out, box-shadow 0.15s ease-out;
}
/* 可选：透明，悬停给一圈强调描边（可点） */
.rs-layer.is-selectable {
  pointer-events: auto;
  cursor: pointer;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 55%, transparent);
}
.rs-layer.is-selectable.is-hover {
  background: color-mix(in srgb, var(--ui-accent) 14%, transparent);
  box-shadow: inset 0 0 0 2px var(--ui-accent);
}
/* 已连：点它取消 —— 给一层淡淡的强调底 */
.rs-layer.is-connected {
  pointer-events: auto;
  cursor: pointer;
  background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
  box-shadow: inset 0 0 0 1.5px var(--ui-accent);
}
/* 不支持：灰罩压暗（用户要的「显示为灰色，并带有透明度效果」），不可点 */
.rs-layer.is-blocked {
  background: color-mix(in srgb, var(--ui-scrim) 42%, transparent);
  pointer-events: none;
}
/* 自己：只描一圈边（顶栏另给「返回节点」） */
.rs-layer.is-owner {
  pointer-events: none;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ui-accent) 40%, transparent);
}

/* 序号角标（左上角小圆号） */
.rs-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ui-accent);
  color: var(--ui-primary-ink, #ffffff);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.rs-layer.is-connected .rs-badge {
  /* 已连与可选靠"填充强度 + 角标符号"区分，不引入第二个品牌色（规范 §1：强调色唯一） */
  background: var(--ui-accent);
  color: var(--ui-primary-ink, #ffffff);
}
.rs-layer.is-blocked .rs-badge {
  display: none;
}

/* 悬停提示：**鼠标跟随**（用户要求），fixed 定位在光标右下角外侧 */
.rs-hint {
  position: fixed;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--ui-tip);
  color: var(--ui-tip-ink);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  /* 只做位移，避免 opacity 过渡在快速移动时"追不上"光标 */
  will-change: transform;
}
.rs-hint.is-connected {
  /* 已连的提示用强调色底（与"可点"的深色胶囊区分） */
  background: var(--ui-accent);
  color: var(--ui-tip-ink);
}

/* 底部 Esc 提示 */
.rs-esc {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
}
.rs-esc-key {
  padding: 2px 8px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--ui-panel, #fff);
  font-size: 11px;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .rs-layer,
  .rs-hint,
  .rs-top-btn,
  .rs-top-close {
    transition: none !important;
  }
}
</style>
