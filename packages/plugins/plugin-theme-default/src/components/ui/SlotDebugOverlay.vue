<script setup lang="ts">
/**
 * SlotDebugOverlay —— 插槽调试的**全局**覆盖层（默认主题提供，全应用只挂一次）。
 *
 * 为什么不放进每个 SlotComposer：
 * - 插槽分散在画布内外（底栏/状态条/抽屉/设置导航/画布浮层），逐个传 debug 参数
 *   既啰嗦又让渲染层认识主题组件，方向是反的（2026-10-28 用户口径）。
 * - 这里只读 DOM：`[data-slot]`（插槽容器）与 `[data-slot-id]`（条目）由
 *   canvas-render 永远写出，不需要任何组件参数。
 *
 * 交互：
 * - 开关 = `<html data-slot-debug="on">`（CSS 负责描边与右上角角标）；
 * - 鼠标移到**角标**（右上角伪元素区域）上才展开面板；
 * - 面板复用主题的 Dropdown（trigger=hover），默认在角标上方居中，
 *   靠近视口边缘时由 Dropdown 自己翻转，永远留在可视区内。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Dropdown from './Dropdown.vue'

/** 角标热区边长（与 slot-debug.css 的 ::after 尺寸对齐） */
const BADGE_SIZE = 14
/** 覆盖在角标上的透明热区（比角标略大，hover 更稳） */
const HIT_SIZE = 18

interface TargetInfo {
  /** 'slot' = 插槽容器；'item' = 插槽里的条目 */
  kind: 'slot' | 'item'
  slot: string
  id?: string
  order?: string
  before?: string
  after?: string
  /** 角标左上角（fixed 视口坐标） */
  x: number
  y: number
}

const target = ref<TargetInfo | null>(null)
/** 面板开关：命中角标即展开，离开角标（且不在面板里）即收起 */
const open = ref(false)
const anchorStyle = computed(() =>
  target.value
    ? {
        left: target.value.x + BADGE_SIZE / 2 - HIT_SIZE / 2 + 'px',
        top: target.value.y + BADGE_SIZE / 2 - HIT_SIZE / 2 + 'px',
      }
    : {},
)

const rows = computed(() => {
  const t = target.value
  if (!t) return []
  if (t.kind === 'slot') {
    return [
      { key: '类型', value: '插槽（放东西的位置）' },
      { key: '槽名', value: t.slot },
      { key: '条目数', value: t.order ?? '' },
      {
        key: '用法',
        value: "ctx.slots.register('" + t.slot + "', { id: '插件名/条目', order })",
      },
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

/** 读取角标热区是否命中：右上角 BADGE_SIZE 见方（与 ::after 一致） */
function hitBadge(el: HTMLElement, cx: number, cy: number): boolean {
  const r = el.getBoundingClientRect()
  const left = r.right - BADGE_SIZE / 2
  const top = r.top - BADGE_SIZE / 2
  return cx >= left && cx <= left + BADGE_SIZE && cy >= top && cy <= top + BADGE_SIZE
}

function pick(cx: number, cy: number): TargetInfo | null {
  const items = document.querySelectorAll<HTMLElement>('[data-slot-id]')
  for (const el of items) {
    if (!hitBadge(el, cx, cy)) continue
    const slotHost = el.closest<HTMLElement>('[data-slot]')
    return {
      kind: 'item',
      slot: slotHost?.dataset.slot ?? '',
      id: el.dataset.slotId,
      order: el.dataset.slotOrder,
      before: el.dataset.slotBefore,
      after: el.dataset.slotAfter,
      x: el.getBoundingClientRect().right - BADGE_SIZE / 2,
      y: el.getBoundingClientRect().top - BADGE_SIZE / 2,
    }
  }
  const slots = document.querySelectorAll<HTMLElement>('[data-slot]')
  for (const el of slots) {
    if (el.hasAttribute('data-slot-id')) continue
    if (!hitBadge(el, cx, cy)) continue
    return {
      kind: 'slot',
      slot: el.dataset.slot ?? '',
      order: el.dataset.slotCount,
      x: el.getBoundingClientRect().right - BADGE_SIZE / 2,
      y: el.getBoundingClientRect().top - BADGE_SIZE / 2,
    }
  }
  return null
}

let raf = 0
function onMove(e: PointerEvent): void {
  if (!document.documentElement.hasAttribute('data-slot-debug')) return
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const next = pick(e.clientX, e.clientY)
    if (!next) {
      // 已经展开的面板本身不要因为鼠标移进去就关闭（Dropdown 自己会管离开）
      target.value = null
      return
    }
    const same = target.value && next.x === target.value.x && next.y === target.value.y
    target.value = next
    if (!same) {
      open.value = false
    }
  })
}

// 面板被 Dropdown 自己关掉（鼠标离开）时同步状态
watch(open, (v) => {
  if (!v) target.value = null
})

onMounted(() => {
  document.addEventListener('pointermove', onMove, { passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onMove)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="slot-debug-overlay" aria-hidden="true">
    <!-- 透明热区覆盖在角标上：鼠标停在这里 = 停在触发器上，Dropdown 的 hover 才成立 -->
    <div v-if="target" class="slot-debug-anchor" :style="anchorStyle">
      <Dropdown v-model="open" trigger="hover" placement="top" :offset="10" :arrow="true"
        menu-width="max-content" body-class="sdo-body">
        <template #trigger>
          <span class="slot-debug-anchor-dot" />
        </template>
        <dl class="sdo-list">
          <template v-for="(row, i) in rows" :key="i">
            <dt>{{ row.key }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
      </Dropdown>
    </div>
  </div>
</template>

<style>
/* 非 scoped：菜单被 Teleport 到 body，scoped 命不中 */
.slot-debug-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000;
  pointer-events: none;
}
.slot-debug-anchor {
  position: fixed;
  /* 与角标同尺寸的透明热区：Dropdown 据此计算位置与判断 hover */
  width: 18px;
  height: 18px;
  pointer-events: auto;
}
.slot-debug-anchor-dot {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
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
