<script setup lang="ts">
/**
 * SlotDebugOverlay —— 插槽调试的全局说明层（默认主题提供，全应用只挂一次）。
 *
 * 逻辑（2026-10-28 用户口径）：
 * 1. 在 window 上监听 pointermove，用坐标判断指针是否落在"角标"（元素右上角）附近；
 * 2. 命中后读该元素的 data-slot / data-slot-id / order / before / after；
 * 3. 用**主题同一套定位规则**（上方居中、超出则翻转、贴边收进视口）渲染面板；
 * 4. 指针离开角标和面板后延时关闭。
 *
 * 为什么不直接嵌 Dropdown 组件：它的 hover 判定要求指针物理进入触发器，
 * 而调试角标是 CSS 伪元素、没有独立 DOM，触发器只能叠在业务按钮上 ——
 * 既挡点击、又常因 0 尺寸算不出位置。这里的命中判定与定位都由本组件完成，
 * 但样式与“上方居中/翻转/视口内”规则完全沿用主题 Dropdown。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 角标尺寸（与 slot-debug.css 的 ::after 对齐） */
const BADGE = 12
/** 命中容差：角标周围 10px 也算 */
const TOLERANCE = 10
/** 面板与角标的间距 */
const GAP = 10
/** 关面板延时（ms）：用户口径 500，留足从角标移到面板 / 手抖的时间 */
const CLOSE_DELAY = 500

interface Target {
  kind: 'slot' | 'item'
  slot: string
  id?: string
  order?: string
  before?: string
  after?: string
  /** 角标中心（视口坐标） */
  cx: number
  cy: number
}

const target = ref<Target | null>(null)
const enabled = ref(false)
const visible = ref(false)
/** 面板尺寸（打开后测量，用于定位与翻转） */
const panelW = ref(220)
const panelH = ref(120)
const panelRef = ref<HTMLElement | null>(null)

let closeTimer: ReturnType<typeof setTimeout> | null = null
let raf = 0
let pointerX = -1
let pointerY = -1
let overPanel = false

/** 定位：与主题 Dropdown 的 placement=top 规则一致（上方居中、越界翻转/内收） */
const panelStyle = computed(() => {
  const t = target.value
  if (!t) return {}
  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight
  const w = panelW.value
  const h = panelH.value
  let left = t.cx - w / 2
  let top = t.cy - h - GAP

  // 上方放不下 → 翻到下方
  if (top < 8 && t.cy + h + GAP < vh - 8) top = t.cy + GAP
  // 左右/上下都收进视口
  if (left + w > vw - 8) left = vw - w - 8
  if (left < 8) left = 8
  if (top + h > vh - 8) top = Math.max(8, vh - h - 8)
  if (top < 8) top = 8
  return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' }
})

const rows = computed(() => {
  const t = target.value
  if (!t) return []
  if (t.kind === 'slot') {
    return [
      { key: '类型', value: '插槽（放东西的位置）' },
      { key: '槽名', value: t.slot },
      { key: '条目数', value: t.order ?? '0' },
      { key: '用法', value: "ctx.slots.register('" + t.slot + "', { id: '插件名/条目', order })" },
    ]
  }
  return [
    { key: '类型', value: '条目（放进插槽的东西）' },
    { key: 'id', value: t.id ?? '' },
    { key: 'order', value: t.order ?? '' },
    ...(t.before ? [{ key: 'before', value: t.before }] : []),
    ...(t.after ? [{ key: 'after', value: t.after }] : []),
    { key: '来源', value: (t.id ?? '').startsWith('host/') ? '宿主内置' : '插件' },
    { key: '所在插槽', value: t.slot },
  ]
})

function cancelClose(): void {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}
function scheduleClose(): void {
  cancelClose()
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (overPanel) return
    visible.value = false
    target.value = null
  }, CLOSE_DELAY)
}

/** 指针是否在元素右上角的角标附近 */
function onBadge(el: HTMLElement, x: number, y: number): boolean {
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return false
  return Math.abs(x - r.right) <= BADGE / 2 + TOLERANCE && Math.abs(y - r.top) <= BADGE / 2 + TOLERANCE
}

function pick(x: number, y: number): Target | null {
  // 条目优先（更具体）；都带 data-slot-id
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot-id]')) {
    if (!onBadge(el, x, y)) continue
    const r = el.getBoundingClientRect()
    const host = el.closest<HTMLElement>('[data-slot]')
    return {
      kind: 'item',
      slot: host?.dataset.slot ?? '',
      id: el.dataset.slotId,
      order: el.dataset.slotOrder,
      before: el.dataset.slotBefore,
      after: el.dataset.slotAfter,
      cx: r.right,
      cy: r.top,
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot]')) {
    if (el.hasAttribute('data-slot-id')) continue
    if (!onBadge(el, x, y)) continue
    const r = el.getBoundingClientRect()
    return {
      kind: 'slot',
      slot: el.dataset.slot ?? '',
      order: el.dataset.slotCount,
      cx: r.right,
      cy: r.top,
    }
  }
  return null
}

function measure(): void {
  const el = panelRef.value
  if (!el) return
  panelW.value = el.offsetWidth || panelW.value
  panelH.value = el.offsetHeight || panelH.value
}

/** 全局鼠标移动：只在角标附近才换目标并打开面板 */
function onMove(e: PointerEvent): void {
  if (!enabled.value) return
  pointerX = e.clientX
  pointerY = e.clientY
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const next = pick(pointerX, pointerY)
    if (!next) {
      if (visible.value) scheduleClose()
      return
    }
    cancelClose()
    const same =
      target.value &&
      target.value.kind === next.kind &&
      target.value.slot === next.slot &&
      target.value.id === next.id
    target.value = next
    if (!same) {
      visible.value = true
      // 面板渲染后再量一次尺寸，首次打开也能摆正
      requestAnimationFrame(measure)
    }
  })
}

/** 面板本身可悬停：移进去不关 */
function onDocOver(e: PointerEvent): void {
  const el = e.target as HTMLElement | null
  if (!el) return
  const was = overPanel
  overPanel = !!el.closest('.sdo-body')
  if (overPanel && !was) cancelClose()
  if (!overPanel && was) scheduleClose()
}

let observer: MutationObserver | undefined
function syncEnabled(): void {
  const on = document.documentElement.hasAttribute('data-slot-debug')
  if (on === enabled.value) return
  enabled.value = on
  if (!on) {
    visible.value = false
    target.value = null
  }
}

onMounted(() => {
  syncEnabled()
  observer = new MutationObserver(syncEnabled)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-slot-debug'],
  })
  window.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerover', onDocOver, true)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('pointermove', onMove)
  document.removeEventListener('pointerover', onDocOver, true)
  cancelClose()
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <!-- 整层不接事件：命中判断由 window 上的 pointermove 完成，绝不挡业务点击 -->
  <div v-if="enabled" class="slot-debug-overlay" aria-hidden="true">
    <div v-if="visible && target" ref="panelRef" class="sdo-body" :style="panelStyle" role="tooltip">
      <dl class="sdo-list">
        <template v-for="(row, i) in rows" :key="i">
          <dt>{{ row.key }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </div>
  </div>
</template>

<style>
/* 非 scoped：面板固定在视口上，不依赖任何祖先的 overflow/transform */
.slot-debug-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000;
  pointer-events: none;
}
.sdo-body {
  position: fixed;
  padding: var(--dd-padding, 6px);
  min-width: 200px;
  max-width: 340px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  border: 1px solid var(--dd-line, rgb(0 0 0 / 0.08));
  border-radius: var(--dd-radius, 12px);
  background: var(--dd-bg, #fff);
  color: var(--dd-ink, #374151);
  box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(15 23 42 / 0.16));
  /* 只有面板自己接事件：鼠标移进去不关，也不会点到画布 */
  pointer-events: auto;
}
.sdo-list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 10px;
  margin: 0;
  font: 500 11px/1.5 ui-monospace, Menlo, Consolas, monospace;
  text-align: left;
}
.sdo-list dt { color: var(--ui-ink-mute, #8c95a3); }
.sdo-list dd {
  margin: 0;
  color: var(--ui-ink, #18202b);
  word-break: break-all;
  /* 右侧的值允许选中复制（常用于复制 id / 槽名去写注册代码） */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
</style>
