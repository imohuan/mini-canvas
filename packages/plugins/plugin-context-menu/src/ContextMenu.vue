<script setup lang="ts">
/**
 * ContextMenu —— 右键菜单浮层（插件自管 UI，挂 body）。
 *
 * item 视觉对齐快捷键帮助面板（老版 CanvasMenu / ShortcutHelpPanel 同一套母体）：
 * - 左侧 28px 圆角图标托（恒渲染，无图标给默认占位）；
 * - 中间名称 + hover 时名称上移、下方浮现描述（hasDescription 行才动效）；
 * - 右侧键帽 chips 显示快捷键（mod 已按平台译成 Ctrl/⌘）。
 *
 * 其余行为不变：fixed(clientX,clientY) 翻折定位；按 group 连续分组 + 分隔线；
 * 点击 props.onSelect(item)；点外部/按 Esc/滚动关闭由宿主插件负责监听。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'
import type { ContextMenuItem } from './menuBuilder'
import { splitComboChips } from './shortcutText'
import { mainMenuPosition, measureViewport, submenuPosition, type Size } from './menuPlacement'

/** 菜单浮层 UI 状态（reactive 对象整体传入；visible/x/y/items 变化自动重渲染） */
export interface ContextMenuUiState {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}

const props = defineProps<{
  state: ContextMenuUiState
  onSelect: (item: ContextMenuItem) => void
  onClose: () => void
}>()

/** 一行：叶子（点了就执行）或"带子菜单的入口"（悬停展开右栏） */
interface MenuRow {
  key: string
  label: string
  /** 叶子：点了执行它 */
  item?: ContextMenuItem
  /** 子菜单里的项（只有入口行才有） */
  children?: Array<{ key: string; label: string; item: ContextMenuItem }>
}

/**
 * 按**分组路径**折叠成「一级分组 → 行」。
 *
 * 为什么要按路径而不是按 group 字符串：注册方在 group / title 里写斜杠
 * （`资源库/节点`）时，那几段应当变成嵌套菜单，而不是一个字面含斜杠的分组名。
 * 路径长度 1 = 直接是一行；长度 ≥2 = 先出现一个入口行（同名只出现一次），
 * 它的子项挂在右栏里。items 已按 order 排好，这里按**首次出现**顺序收集即可。
 */
const groups = computed(() => {
  const out: Array<{ group: string; rows: MenuRow[] }> = []
  for (const item of props.state.items) {
    const path = item.path && item.path.length > 0 ? item.path : [item.group]
    const top = path[0]!
    let g = out.find((x) => x.group === top)
    if (!g) {
      g = { group: top, rows: [] }
      out.push(g)
    }
    if (path.length === 1) {
      g.rows.push({ key: item.id, label: item.label, item })
      continue
    }
    const key = 'sub:' + path.join('/')
    let row = g.rows.find((r) => r.key === key)
    if (!row) {
      row = { key, label: path[1]!, children: [] }
      g.rows.push(row)
    }
    // 子项文案 = 这一项自己的名字（叶子）；中间的层级只在"入口行"上体现（上面的 label）
    row.children!.push({ key: item.id, label: item.label, item })
  }
  return out.filter((g) => g.rows.length > 0)
})

/** 当前展开的入口行（同一时刻只开一层，二级菜单够用；移开就收） */
const openKey = ref<string | null>(null)
/** 右栏的纵向位置（贴着那一行） */
const openTop = ref(0)
/** 主菜单实测尺寸（真实渲染后才能量到；v-if 首帧为 null） */
const mainSize = ref<Size | null>(null)
/** 二级菜单实测尺寸 */
const subSize = ref<Size | null>(null)
/** 主菜单 DOM（量尺寸 / 观察内容变化） */
const mainRef = ref<HTMLElement | null>(null)
/** 二级菜单 DOM */
const subRef = ref<HTMLElement | null>(null)
/** 视口尺寸（窗口 resize 时更新，避免旋转屏幕后还按旧宽度算） */
const viewport = ref(measureViewport())
/** 当前展开行对应的子项 */
const openChildren = computed(() => {
  if (!openKey.value) return []
  for (const g of groups.value) {
    const row = g.rows.find((r) => r.key === openKey.value)
    if (row?.children) return row.children
  }
  return []
})

/** 悬停入口行 → 展开右栏（贴着这一行）；移到普通行就收起来 */
function onRowHover(row: MenuRow, e: MouseEvent): void {
  if (!row.children) {
    openKey.value = null
    return
  }
  openKey.value = row.key
  // 用两块的真实 rect 求行在菜单内的纵向偏移：主菜单内部滚动后 offsetTop 仍是未滚动的值，
  // 直接用会把二级菜单算到下面去。
  const el = e.currentTarget as HTMLElement
  const main = mainRef.value
  openTop.value = main
    ? el.getBoundingClientRect().top - main.getBoundingClientRect().top
    : el.offsetTop
}

/** 主菜单内部滚动：收掉展开的二级菜单，避免它挂在旧位置 */
function onMainScroll(): void {
  openKey.value = null
}

/**
 * 量面板真实尺寸。
 *
 * 为什么必须在渲染后量：旧实现用「条数 × 44 + 48」估高，带描述/快捷键的行更高，
 * 估算偏小 → 面板底部压到屏幕边（用户截图的主菜单与底栏重合）。
 * 只在尺寸真的变了才写回，避免 ResizeObserver 自触发死循环。
 */
function measureMenu(): void {
  const main = mainRef.value
  if (main) {
    const w = main.offsetWidth
    const h = main.offsetHeight
    if (w > 0 && h > 0 && (mainSize.value?.width !== w || mainSize.value?.height !== h)) {
      mainSize.value = { width: w, height: h }
    }
  }
  const sub = subRef.value
  if (sub) {
    const w = sub.offsetWidth
    const h = sub.offsetHeight
    if (w > 0 && h > 0 && (subSize.value?.width !== w || subSize.value?.height !== h)) {
      subSize.value = { width: w, height: h }
    }
  }
}

let resizeObserver: ResizeObserver | null = null

/** 首次渲染前先量；尺寸变化（内容/字体/主题切换）跟着重算 */
function observeMenus(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => measureMenu())
  if (mainRef.value) resizeObserver.observe(mainRef.value)
  if (subRef.value) resizeObserver.observe(subRef.value)
}

function onWindowResize(): void {
  viewport.value = measureViewport()
  measureMenu()
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  void nextTick(() => {
    measureMenu()
    observeMenus()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  resizeObserver?.disconnect()
  resizeObserver = null
})

/** 菜单内容换了（重新打开/换模式）→ 收掉展开态，别留着上回的残余 */
watch(
  () => props.state.items,
  () => {
    openKey.value = null
    mainSize.value = null
    subSize.value = null
    openTop.value = 0
    void nextTick(() => {
      measureMenu()
      observeMenus()
    })
  },
  { flush: 'post' },
)

/** 二级菜单展开后量它的真实尺寸（同一条入口行的子项数量会变） */
watch(
  openKey,
  () => {
    subSize.value = null
    void nextTick(() => {
      measureMenu()
      observeMenus()
    })
  },
  { flush: 'post' },
)

/** 菜单显示/隐藏（重新打开）也要重新量：v-if 会重建 DOM */
watch(
  () => props.state.visible,
  (visible) => {
    if (!visible) {
      // 元素已卸载：停掉观察，避免 observer 继续持有旧 DOM
      resizeObserver?.disconnect()
      resizeObserver = null
      mainSize.value = null
      subSize.value = null
      return
    }
    mainSize.value = null
    subSize.value = null
    void nextTick(() => {
      measureMenu()
      observeMenus()
    })
  },
  { flush: 'post' },
)

/**
 * 主菜单左上角：用实测尺寸算，整块收进视口并留 8px 间隔。
 * 首帧（还没量到）先用最小尺寸顶一帧，量完立刻校正。
 */
const position = computed(() => {
  const size = mainSize.value ?? { width: 252, height: 1 }
  const { left, top } = mainMenuPosition(
    { x: props.state.x, y: props.state.y },
    size,
    viewport.value,
  )
  return { left, top }
})

/**
 * 二级菜单左上角：右侧放不下就翻到主菜单左侧；纵向贴着入口行并夹在视口内。
 * 首帧用最小尺寸，实测后立即重算。
 */
const submenu = computed(() => {
  const size = subSize.value ?? { width: 252, height: 1 }
  return submenuPosition(
    position.value,
    mainSize.value ?? { width: 252, height: 1 },
    openTop.value,
    size,
    viewport.value,
  )
})

function onItemClick(item: ContextMenuItem): void {
  props.onSelect(item)
}

/** 行是否有 hover 描述（决定 label 上移动效开关） */
function hasDesc(item: ContextMenuItem): boolean {
  return !!item.description
}

/** 每条快捷键组合拆成键帽片段（['mod+z'] → [['Ctrl','Z']]；多键 / 连接） */
function chipsOf(item: ContextMenuItem): Array<{ combo: string[] }> {
  return splitComboChips(item.shortcut)
}

/** 图标形态：html=svg 字符串（v-html）/ component=Vue 组件（<component :is>）/ none=走默认占位 svg */
function iconMode(item: ContextMenuItem): 'html' | 'component' | 'none' {
  return iconRenderMode(item.icon)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-pop">
      <div
        v-if="state.visible"
        ref="mainRef"
        class="ctx-menu"
        :style="{ left: position.left + 'px', top: position.top + 'px' }"
        role="menu"
        @contextmenu.prevent
        @scroll.passive="onMainScroll"
      >
        <template v-for="(group, gi) in groups" :key="group.group">
          <div v-if="gi > 0" class="ctx-menu-divider" />
          <button
            v-for="row in group.rows"
            :key="row.key"
            type="button"
            class="ctx-menu-item"
            :class="{ 'is-danger': row.item?.danger, hasDescription: row.item ? hasDesc(row.item) : false, 'is-open': openKey === row.key }"
            role="menuitem"
            :aria-haspopup="row.children ? 'menu' : undefined"
            :aria-expanded="row.children ? openKey === row.key : undefined"
            @mouseenter="onRowHover(row, $event)"
            @click.stop="row.children ? undefined : onItemClick(row.item!)"
          >
            <!-- 图标托：恒渲染（无 icon 时给默认占位），与快捷键面板/CanvasMenu 一致 -->
            <span class="ctx-menu-icon">
              <span v-if="row.item && iconMode(row.item) === 'html'" class="ctx-menu-icon-raw" v-html="row.item.icon" />
              <component v-else-if="row.item && iconMode(row.item) === 'component'" :is="row.item.icon" class="ctx-menu-icon-raw" />
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>
            </span>

            <!-- 名称 + hover 描述 -->
            <span class="ctx-menu-copy">
              <span class="ctx-menu-label">{{ row.label }}</span>
              <span v-if="row.item?.description" class="ctx-menu-description">{{ row.item.description }}</span>
            </span>

            <!-- 右侧键帽快捷键 -->
            <span v-if="row.item?.shortcut?.length" class="ctx-menu-shortcuts">
              <template v-for="(chip, ci) in chipsOf(row.item!)" :key="ci">
                <span v-if="ci > 0" class="ctx-menu-shortcut-sep">/</span>
                <span class="kbd-chip" v-for="(cap, pi) in chip.combo" :key="pi">{{ cap }}</span>
              </template>
            </span>
            <!-- 入口行：右侧一个指向右的箭头（表示"里面有子菜单"） -->
            <span v-else-if="row.children" class="ctx-menu-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </button>
        </template>
      </div>
    </Transition>

    <!-- 二级菜单：贴着展开的那一行、在主栏右侧；同一个浮层组件，跟着主菜单一起出现/消失 -->
    <Transition name="ctx-pop">
      <div
        v-if="state.visible && openChildren.length"
        ref="subRef"
        class="ctx-menu ctx-submenu"
        :style="{ left: submenu.left + 'px', top: submenu.top + 'px' }"
        role="menu"
        @contextmenu.prevent
      >
        <button
          v-for="child in openChildren"
          :key="child.key"
          type="button"
          class="ctx-menu-item"
          :class="{ 'is-danger': child.item.danger, hasDescription: hasDesc(child.item) }"
          role="menuitem"
          @click.stop="onItemClick(child.item)"
        >
          <span class="ctx-menu-icon">
            <span v-if="iconMode(child.item) === 'html'" class="ctx-menu-icon-raw" v-html="child.item.icon" />
            <component v-else-if="iconMode(child.item) === 'component'" :is="child.item.icon" class="ctx-menu-icon-raw" />
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>
          </span>
          <span class="ctx-menu-copy">
            <span class="ctx-menu-label">{{ child.label }}</span>
            <span v-if="child.item.description" class="ctx-menu-description">{{ child.item.description }}</span>
          </span>
          <span v-if="child.item.shortcut?.length" class="ctx-menu-shortcuts">
            <template v-for="(chip, ci) in chipsOf(child.item)" :key="ci">
              <span v-if="ci > 0" class="ctx-menu-shortcut-sep">/</span>
              <span class="kbd-chip" v-for="(cap, pi) in chip.combo" :key="pi">{{ cap }}</span>
            </template>
          </span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 配色全部走通用 UI token（--ui-*，由 <html data-canvas-theme> 切换；值见
   @mini-canvas/canvas-render/src/styles/ui-theme.css）。本组件不带任何主题配置项。
   背景用**不透光档** --ui-overlay-solid（与节点控制栏同一档）：菜单压在画布节点/图片上，
   半透明毛玻璃会让底下的内容透出来、字读不清（用户口径 2026-10-04：把这个透明度删掉）。 */
.ctx-menu {
  position: fixed;
  /* z-index 走画布层叠带变量（--layer-modal，唯一事实源见 canvas-render/contracts/layers.ts） */
  z-index: var(--layer-modal, 100000);
  min-width: 252px;
  max-width: 340px;
  /* 视口不够高时菜单在**自己内部**滚动，绝不撑出屏幕；上下各留 8px（与定位函数同一间隔）。 */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 菜单容器的内边距（规范 §2.4：菜单容器 10px），行与卡片边缘之间有呼吸空间 */
  padding: 10px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 16px;
  background: var(--ui-overlay-solid, #ffffff);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.1));
  color: var(--ui-ink, #374151);
  font-size: 13px;
  user-select: none;
}
.ctx-menu::-webkit-scrollbar {
  width: 6px;
}
.ctx-menu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--ui-scroll-thumb, rgba(0, 0, 0, 0.2));
}
.ctx-menu::-webkit-scrollbar-thumb:hover {
  background: var(--ui-scroll-thumb-hover, rgba(0, 0, 0, 0.32));
}
.ctx-menu-divider {
  height: 1px;
  margin: 5px 6px;
  background: var(--ui-line, rgba(0, 0, 0, 0.06));
}

/* ===== 二级菜单（贴着展开那一行的右栏）=====
   同一个浮层组件再渲染一份，锚点是**主菜单的左边缘 + 主菜单宽度**，纵向贴着入口行。
   数值与主栏同一套 token：外圆 16、行圆 10、同一档阴影与发丝边。 */
.ctx-submenu {
  animation: ctx-sub-in 0.16s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes ctx-sub-in {
  from {
    opacity: 0;
    transform: translateX(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 展开中的入口行：与 hover 同一底色 + 强调色文字（"当前开着的是它"） */
.ctx-menu-item.is-open {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
}
.ctx-menu-item.is-open .ctx-menu-label {
  color: var(--ui-accent, #0891b2);
}

/* 入口行右侧的"有子菜单"箭头 */
.ctx-menu-arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  color: var(--ui-ink-dim, #9ca3af);
}
.ctx-menu-arrow svg {
  width: 14px;
  height: 14px;
}

/* ===== item（对齐快捷键面板 canvas-menu-item 数值）===== */
.ctx-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: ctx-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}
.ctx-menu-item:hover:not(.is-disabled) {
  background: var(--ui-hover, rgba(0, 0, 0, 0.05));
}
.ctx-menu-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.38;
}
.ctx-menu-item.is-danger {
  color: var(--ui-danger, #ef4444);
}
.ctx-menu-item.is-danger:hover:not(.is-disabled) {
  background: var(--ui-danger-soft, rgba(239, 68, 68, 0.1));
}
.ctx-menu-item.is-danger .ctx-menu-icon {
  color: var(--ui-danger, #ef4444);
  background: var(--ui-danger-veil, rgba(239, 68, 68, 0.08));
}

/* 图标托 */
.ctx-menu-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--ui-ink-dim, #6b7280);
  background: var(--ui-veil, rgba(0, 0, 0, 0.04));
}
.ctx-menu-icon-raw {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-style: normal;
}
.ctx-menu-icon :deep(svg),
.ctx-menu-icon svg {
  width: 16px;
  height: 16px;
}

/* 名称/描述区：label 绝对垂直居中；hover 上移 + 下方浮现描述 */
.ctx-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 32px;
}
.ctx-menu-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  color: var(--ui-ink, #111827);
  transform: translateY(-50%);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.hasDescription .ctx-menu-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .ctx-menu-label,
.hasDescription:focus-within .ctx-menu-label {
  top: 3px;
  transform: translateY(0);
}
.ctx-menu-description {
  color: var(--ui-ink-dim, #9ca3af);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  position: absolute;
  bottom: 3px;
  left: 0;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .ctx-menu-description,
.hasDescription:focus-within .ctx-menu-description {
  opacity: 1;
  transform: translateY(0);
}

/* 右侧键帽快捷键 */
.ctx-menu-shortcuts {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-left: 4px;
}
.ctx-menu-shortcut-sep {
  color: var(--ui-ink-dim, #9ca3af);
  font-size: 10px;
  font-weight: 700;
  margin: 0 1px;
}
.kbd-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--ui-panel, #ffffff);
  color: var(--ui-ink, #374151);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  font-family: ui-monospace, "JetBrains Mono", monospace;
}

.ctx-pop-enter-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ctx-pop-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}
.ctx-pop-leave-active {
  transition: opacity 0.1s ease;
}
.ctx-pop-leave-to {
  opacity: 0;
}

@keyframes ctx-item-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ctx-menu,
  .ctx-menu-item,
  .ctx-menu-label,
  .ctx-menu-description {
    animation: none !important;
    transition: none !important;
  }
  .hasDescription:hover .ctx-menu-label,
  .hasDescription:focus-within .ctx-menu-label {
    top: 3px;
    transform: translateY(0);
  }
  .hasDescription:hover .ctx-menu-description,
  .hasDescription:focus-within .ctx-menu-description {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
