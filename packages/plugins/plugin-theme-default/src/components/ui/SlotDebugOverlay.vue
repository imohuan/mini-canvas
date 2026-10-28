<script setup lang="ts">
/**
 * SlotDebugOverlay —— 插槽调试的全局说明层（默认主题提供，全应用只挂一次）。
 *
 * 设计（2026-10-28 用户口径）：
 * - canvas-render 只输出标记（data-slot / data-slot-id / order / before / after）；
 * - 本组件读标记，给每个角标生成一个**透明的 Dropdown 触发器**，盖在角标位置；
 * - 鼠标真正悬停到触发器上时，由主题 Dropdown 自己做 hover 展开、离开延时关闭、
 *   上方居中与出屏翻转 —— 不重复实现一套开关逻辑（之前那版反复重挂面板，肉眼看就是"不显示"）。
 *
 * 注意：触发器不能挡业务点击（pointer-events: none），只有角标那 18px 热区可命中。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Dropdown from './Dropdown.vue'

/** 角标半径（与 slot-debug.css 的 ::after 对齐） */
const BADGE = 12
/** 透明热区边长（比角标略大，好悬停） */
const HIT = 20

interface Target {
  key: string
  kind: 'slot' | 'item'
  slot: string
  id?: string
  order?: string
  before?: string
  after?: string
  left: number
  top: number
}

const targets = ref<Target[]>([])
const enabled = ref(false)

/** 扫描 DOM：每个插槽容器 / 条目各生成一个触发器（位置=各自右上角角标） */
function scan(): void {
  if (typeof document === 'undefined') return
  const on = document.documentElement.hasAttribute('data-slot-debug')
  if (on !== enabled.value) enabled.value = on
  if (!on) {
    targets.value = []
    return
  }
  const next: Target[] = []
  const seen = new Set<string>()
  const add = (t: Target): void => {
    if (seen.has(t.key)) return
    seen.add(t.key)
    next.push(t)
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot-id]')) {
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    const host = el.closest<HTMLElement>('[data-slot]')
    add({
      key: 'i:' + (el.dataset.slotId ?? ''),
      kind: 'item',
      slot: host?.dataset.slot ?? '',
      id: el.dataset.slotId,
      order: el.dataset.slotOrder,
      before: el.dataset.slotBefore,
      after: el.dataset.slotAfter,
      left: r.right - BADGE / 2 - HIT / 2,
      top: r.top - BADGE / 2 - HIT / 2,
    })
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-slot]')) {
    if (el.hasAttribute('data-slot-id')) continue
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    add({
      key: 's:' + (el.dataset.slot ?? ''),
      kind: 'slot',
      slot: el.dataset.slot ?? '',
      order: el.dataset.slotCount,
      left: r.right - BADGE / 2 - HIT / 2,
      top: r.top - BADGE / 2 - HIT / 2,
    })
  }
  /*
   * 重建判定只看"身份"（插槽名 + 条目 id），不看坐标：
   * 坐标由布局决定，鼠标悬停时容器可能轻微位移；若坐标参与 key，
   * 每次移动都会重建整个 Dropdown，正在悬停的面板被卸载 —— 肉眼就是"从不显示"。
   */
  const idOf = (list: Target[]): string => list.map((t) => t.kind + ':' + t.slot + ':' + (t.id ?? '')).join('|')
  if (idOf(next) === idOf(targets.value)) {
    // 身份相同：只更新坐标（不换 key，不卸载组件）
    const prev = new Map(targets.value.map((t) => [t.kind + ':' + t.slot + ':' + (t.id ?? ''), t]))
    for (const t of next) {
      const old = prev.get(t.kind + ':' + t.slot + ':' + (t.id ?? ''))
      if (old) {
        old.left = t.left
        old.top = t.top
      }
    }
    return
  }
  targets.value = next
}

let raf = 0
let observer: MutationObserver | undefined
function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    scan()
  })
}

/** 面板内容：区分"插槽（位置）"与"条目（放进去的东西）" */
function rowsOf(t: Target): Array<{ key: string; value: string }> {
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
}

const styleOf = (t: Target): Record<string, string> => ({
  left: t.left + 'px',
  top: t.top + 'px',
})

onMounted(() => {
  scan()
  observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-slot-debug', 'data-slot', 'data-slot-id'],
  })
  window.addEventListener('resize', schedule, { passive: true })
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', schedule)
  window.removeEventListener('scroll', schedule, true)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div v-if="enabled" class="slot-debug-overlay" aria-hidden="true">
    <div v-for="t in targets" :key="t.key" class="slot-debug-hotspot"
      :class="t.kind === 'slot' ? 'is-slot' : (t.id || '').startsWith('host/') ? 'is-host' : 'is-plugin'"
      :style="styleOf(t)">
      <!-- 触发器是 transparent 覆盖块：Dropdown 用它计算位置并判断 hover -->
      <Dropdown trigger="hover" placement="top" :offset="10" :arrow="true" menu-width="max-content"
        body-class="sdo-body" :hover-close-delay="160">
        <template #trigger>
          <span class="sdo-trigger" />
        </template>
        <dl class="sdo-list">
          <template v-for="(row, i) in rowsOf(t)" :key="i">
            <dt>{{ row.key }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </Dropdown>
    </div>
  </div>
</template>

<style>
/* 非 scoped：Dropdown 菜单 Teleport 到 body，scoped 命不中 */
.slot-debug-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000;
  /* 整层不接事件：只有每个角标热区可悬停，不挡业务点击 */
  pointer-events: none;
}
.slot-debug-hotspot {
  position: fixed;
  width: 20px;
  height: 20px;
  pointer-events: auto;
}
.sdo-trigger {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  /* 透明确保不遮住 CSS 画的角标 */
  background: transparent;
}
.sdo-body {
  padding: 8px 10px;
  min-width: 200px;
  max-width: 340px;
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
.sdo-list dd { margin: 0; color: var(--ui-ink, #18202b); word-break: break-all; }
</style>
