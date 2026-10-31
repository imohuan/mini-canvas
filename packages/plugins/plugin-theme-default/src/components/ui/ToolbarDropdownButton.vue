<script setup lang="ts">
/**
 * ToolbarDropdownButton —— 工具栏里的「下拉按钮」默认件（主题库提供，插件按名取用）。
 *
 * 解决什么问题：以前每个插件要做「一个按钮 + 点开一串菜单」，都得自己拼
 * button + dropdown，甚至自绘浮层；于是同一排按钮里出现不同的圆角/高度/间距，
 * 二级菜单也会被塞进主菜单内部（用户 2026-10-29 截图报的错位）。
 *
 * 这件把「触发按钮 + 菜单面板」收成一个默认件，并遵守两条硬规则：
 * 1. 触发器就是主题 button 本身（观感与旁边的普通按钮逐像素一致）；
 * 2. 菜单是**独立浮层**（dropdown 自己 teleport 到 body），二级菜单也走同一套浮层，
 *    不往主面板里叠内嵌块。
 *
 * 用法：
 *   const DropdownButton = useUiComponent('toolbarDropdown')
 *   <DropdownButton title="宫格切分" :icon="ICON" :items="items" @pick="onPick" />
 *   <DropdownButton title="对齐演示" align="start" :items="items" />
 *
 * items 形状见 ToolbarMenuNode：
 * - children 非空 = 二级文字菜单（悬停或点击展开独立浮层）；
 * - panel 非空   = 右侧展开**自定义面板**（宫格选择器、色板这类），同样走独立浮层。
 *   两种都给了时 panel 优先。
 *
 * 对齐（用户口径 2026-10-29：「当前是居中底部显示，我想可以通过配置来修改，比如底部左对齐」）：
 * - placement 管**方向 + 对齐**：bottom（默认，底部居中）/ bottom-start（底部左对齐）/ bottom-end（底部右对齐）；
 * - align 是**显式开关**，给了就压过 placement 后缀（只想改对齐、不动方向时用它）。
 *
 * ⚠️ 为什么两个都要传：主题默认件 Dropdown 只认 placement 后缀；成品应用里顶替它的
 * AxDropdown 只认 align（它把 -start/-end 后缀当噪音丢弃，默认居中）。只传一个的话，
 * 「换主题 / 换实现」后对齐会悄悄变形 —— 这类「同一个 prop 两套语义」最容易被当成品格问题。
 */
import { computed, ref, shallowRef, onBeforeUnmount, onMounted } from 'vue'
import type { Component } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { childChainFor } from './floatingChain'
import { fitSubPanel } from './subPanelLayout'
import type { ToolbarMenuNode, ToolbarMenuPanelContext } from './types'
import ToolbarDropdownSubPanel from './ToolbarDropdownSubPanel.vue'
import NodeToolbarButton from './NodeToolbarButton.vue'
import DefaultDropdown from './Dropdown.vue'

const props = withDefaults(
  defineProps<{
    title: string
    ariaLabel?: string
    icon?: unknown
    items?: ToolbarMenuNode[]
    variant?: 'ghost' | 'primary' | 'danger'
    active?: boolean
    disabled?: boolean
    menuWidth?: string
    /**
     * 菜单上方那条小箭头（指向触发按钮）。默认开。
     *
     * 用户口径 2026-10-29：「支持显示隐藏 dropdown 的箭头」—— 想在菜单里再套一层自绘面板、
     * 或者菜单本来就贴着按钮（不需要指路）时，把它关掉更干净。
     */
    arrow?: boolean
    /** 菜单方向 + 对齐：bottom / bottom-start / bottom-end / top-…（start=左缘对齐，缺省居中） */
    placement?: string
    /**
     * 横向对齐的显式开关（覆盖 placement 后缀）：
     * start = 菜单左缘贴按钮左缘；center = 菜单中轴对按钮中轴；end = 菜单右缘贴按钮右缘。
     * auto（默认）= 跟 placement 后缀走，没后缀就居中 —— 与普通 dropdown 的写法一致。
     */
    align?: 'auto' | 'start' | 'center' | 'end'
  }>(),
  {
    ariaLabel: undefined,
    icon: undefined,
    items: () => [],
    variant: 'ghost',
    active: undefined,
    disabled: false,
    menuWidth: '220px',
    // 默认关箭头、底部左对齐（用户口径 2026-10-29：「默认隐藏箭头，底部左对齐」）。
    // 这是工具栏下拉最稳的一组：菜单从按钮左缘往右铺，读起来像"按钮展开的一列"；
    // 不带小尖角也不会看不出从哪弹出（菜单紧贴按钮下方）。想要箭头/居中/右对齐显式传。
    arrow: false,
    placement: 'bottom-start',
    align: 'auto',
  },
)

const emit = defineEmits<{
  /**
   * 选中一项。第三个参数是关闭整个下拉的方法：自定义面板里「确定」时
   * 既能处理业务，也能把菜单收起（不必再想办法拿 Dropdown 的 close）。
   */
  (e: 'pick', key: string, path: string[], close: () => void): void
}>()

/**
 * 画布内按名取主题件（换主题零改动）；画布外（文档页、组件展厅的静态预览）
 * 没有 Provider，退回同一份默认实现，组件本身仍可单独渲染。
 */
function useCatalogOrFallback(name: string, fallback: Component) {
  try {
    return useUiComponent(name)
  } catch {
    // 组件句柄不能进深层响应式（Vue 会警告并拖慢渲染）
    return shallowRef(fallback)
  }
}

const Button = useCatalogOrFallback('toolbarButton', NodeToolbarButton)
const Dropdown = useCatalogOrFallback('dropdown', DefaultDropdown)

const open = ref(false)
const openSubKey = ref<string | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

/**
 * 实际生效的横向对齐。
 * align 显式给了就以它为准；否则读 placement 后缀（-start / -end），都没有就居中。
 */
const effectiveAlign = computed<'start' | 'center' | 'end'>(() => {
  if (props.align !== 'auto') return props.align
  const suffix = props.placement.split('-')[1]
  if (suffix === 'start' || suffix === 'center' || suffix === 'end') return suffix
  return 'center'
})

/**
 * 传给**主题默认件 Dropdown** 的 placement：它不看 align，只认后缀。
 * 必须由 effectiveAlign 反推，否则「align 覆盖」在那份实现里会失效。
 */
const resolvedPlacement = computed(() => {
  const side = props.placement.split('-')[0] || 'bottom'
  const a = effectiveAlign.value
  return a === 'center' ? side : side + '-' + a
})

/**
 * 二级菜单与主菜单卡片之间的固定间隔（px）。
 * 用户口径 2026-10-29（带截图）：8px 看着快贴边了，先到 16 再收回到 12（定稿 12）。
 * 两张卡片都是浮层，间隔就是它们之间的空气，不参与任何布局。
 */
const SUB_GAP = 12

/** 子菜单是独立浮层：定位以**主菜单卡片右边**为锚点，并留出间隔 */
const subPos = ref({ left: 0, top: 0 })
/**
 * 二级浮层的组链（父链 + 自己）。
 * 为什么必须有：主下拉的「点外关闭」只认 data-floating-chain —— 二级菜单是 teleport 到 body
 * 的独立元素，不写链就会被判成「点了外面」，点它的条目时父菜单先关、条目点击丢失。
 * 链直接从主面板元素的同名属性读（它就是父链），再追加自己的 id。
 */
const subChain = ref('')
/** 二级浮层的原始锚点（这一行的顶部），重排时始终以它为准 */
let subAnchorTop = 0
/** 打开时算出的最大高度：内容再多也在面板内滚动 */
const subMaxHeight = ref<number | null>(null)
let subTimer: ReturnType<typeof setTimeout> | null = null

function clearSubTimer(): void {
  if (subTimer) { clearTimeout(subTimer); subTimer = null }
}

function openSub(key: string, ev: MouseEvent): void {
  clearSubTimer()
  const row = ev.currentTarget as HTMLElement | null
  if (!row) return
  const r = row.getBoundingClientRect()
  const item = props.items.find((i) => i.key === key)
  /** 自定义面板可能比主菜单宽（宫格选择器是正方形）；翻边判定要按它自己的宽度算 */
  const width = Number.parseInt(item?.panel?.width || props.menuWidth, 10) || 220
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  /**
   * 锚点必须是**主菜单卡片**的右边，而不是这一行的右边：
   * 行右缘在主卡片内部（还有内边距），拿它 +4px 会让二级卡片压在主卡片上/贴死。
   * 右侧放不下就翻到主卡片左侧，同样留 SUB_GAP。
   */
  const main = row.closest('[data-toolbar-dropdown-menu="1"]') as HTMLElement | null
  const mainRect = main?.getBoundingClientRect() ?? null
  /** 子浮层的链 = 这一行所在的父链 + 自己（父链由 childChainFor 沿 DOM 往上读） */
  subChain.value = childChainFor(row, 'tdb-sub')
  const rightEdge = mainRect ? mainRect.right : r.right
  const leftEdge = mainRect ? mainRect.left : r.left
  const left = rightEdge + SUB_GAP + width > vw - 8
    ? Math.max(8, leftEdge - SUB_GAP - width)
    : rightEdge + SUB_GAP
  /** 打开时就算好：贴这一行；下方不够就整体上移，限高在面板内滚 */
  subAnchorTop = r.top
  const box = fitSubPanel(r.top, typeof window === 'undefined' ? 720 : window.innerHeight)
  subPos.value = { left, top: box.top }
  subMaxHeight.value = box.maxHeight
  openSubKey.value = key
}

function scheduleCloseSub(): void {
  clearSubTimer()
  subTimer = setTimeout(() => { openSubKey.value = null }, 220)
}

/**
 * 面板被鼠标划出时要有足够时间移进去：主菜单卡片与右侧面板之间有 12px 空气，
 * 220ms 对自绘面板（要拖选格子）偏短。面板这一档给 400ms，鼠标真的进去就取消关闭。
 */
function scheduleClosePanel(): void {
  clearSubTimer()
  subTimer = setTimeout(() => { openSubKey.value = null }, 400)
}

const openSubItem = computed(() => props.items.find((i) => i.key === openSubKey.value) ?? null)
/** 当前展开项是不是自定义面板（不是文字二级菜单） */
const openSubPanel = computed(() => openSubItem.value?.panel ?? null)
/** 自定义面板的上下文：直接传组件时也能拿到关闭/选择方法 */
const openSubContext = computed<ToolbarMenuPanelContext | null>(() => {
  const node = openSubItem.value
  if (!node || !node.panel) return null
  return {
    key: node.key,
    label: node.label,
    path: [node.key],
    node,
    state: node.panel.state,
    closePanel: () => { openSubKey.value = null },
    close: closeAll,
    pick: (key?: string, path?: string[]) => {
      if (!node.disabled) emit('pick', key ?? node.key, path ?? [node.key], closeAll)
      closeAll()
    },
  }
})
/** 二级里选中一个子项：沿「父 key → 子 key」的路径 emit，并关闭整张卡 */
function pickSub(key: string, path: string[]): void {
  const parent = openSubItem.value
  const child = parent?.children?.find((c) => c.key === key)
  if (!child) return
  pickLeaf(child, path)
}

/** 窗口尺寸变了就按原锚点重算（内容不用重新量） */
function onWindowResize(): void {
  if (!openSubKey.value) return
  const box = fitSubPanel(subAnchorTop, window.innerHeight)
  subPos.value = { ...subPos.value, top: box.top }
  subMaxHeight.value = box.maxHeight
}

/** 滚轮滚主菜单时子浮层的位置会旧：收起，等用户重新指向（同右键菜单的处置） */
function onMenuScroll(): void {
  if (openSubKey.value) openSubKey.value = null
}

function pickLeaf(node: ToolbarMenuNode, path: string[]): void {
  if (node.disabled) return
  emit('pick', node.key, path, closeAll)
  open.value = false
  openSubKey.value = null
}

function onRowClick(node: ToolbarMenuNode, path: string[], ev: MouseEvent): void {
  if (node.panel || node.children?.length) { openSub(node.key, ev); return }
  pickLeaf(node, path)
}

function closeAll(): void {
  open.value = false
  openSubKey.value = null
}

function onDocPointerDown(ev: PointerEvent): void {
  if (!open.value) return
  const target = ev.target as Node
  if (triggerRef.value?.contains(target)) return
  const menu = document.querySelector('[data-toolbar-dropdown-menu="1"]')
  if (menu?.contains(target)) return
  const sub = document.querySelector('[data-toolbar-dropdown-sub="1"]')
  if (sub?.contains(target)) return
  closeAll()
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && open.value) { ev.stopPropagation(); closeAll() }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
  clearSubTimer()
})

void (Button as Component | undefined)
</script>

<template>
  <!--
    placement 与 align **同时传**（理由见文件头）：
    - placement 由 effectiveAlign 反推，给只认后缀的主题默认件用；
    - align 给只认它的 AxDropdown 用（成品应用里它顶替了主题默认件）。
    未声明的 prop 会被 Vue 当作 attr 落到根元素上，所以两份实现都能各取所需、不会互相打架。
  -->
  <component :is="Dropdown || 'div'" v-model="open" :placement="resolvedPlacement" :align="effectiveAlign" :offset="6"
    :menu-width="menuWidth" :teleport="true" :arrow="arrow">
    <template #trigger>
      <span ref="triggerRef" class="tdb-trigger">
        <component :is="Button || 'button'" :title="title" :aria-label="ariaLabel || title"
          :icon="icon" :variant="variant" :active="active" :disabled="disabled"
          aria-haspopup="menu" :aria-expanded="open">
          <slot>{{ title }}</slot>
        </component>
      </span>
    </template>
    <template #default="{ close }">
      <div class="tdb-menu" role="menu" :aria-label="title" data-toolbar-dropdown-menu="1" @scroll="onMenuScroll">
        <button
          v-for="node in items"
          :key="node.key"
          class="tdb-row"
          :class="{ 'is-danger': node.danger, 'is-active': openSubKey === node.key || node.key === openSubKey }"
          type="button"
          role="menuitem"
          :aria-haspopup="node.panel || node.children?.length ? 'menu' : undefined"
          :aria-expanded="node.panel || node.children?.length ? openSubKey === node.key : undefined"
          :disabled="node.disabled"
          @mouseenter="node.panel || node.children?.length ? openSub(node.key, $event) : scheduleCloseSub()"
          @click.stop="node.panel || node.children?.length ? openSub(node.key, $event) : (pickLeaf(node, [node.key]), close())"
        >
          <span class="tdb-label">{{ node.label }}</span>
          <span v-if="node.panel || node.children?.length" class="tdb-chev" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
  </component>

  <!-- 二级浮层：文字二级菜单与自定义面板复用同一套定位 / 浮层链 / 鼠标进出逻辑 -->
  <Teleport to="body">
    <div
      v-if="open && openSubItem && (openSubPanel || openSubItem.children?.length)"
      class="tdb-menu tdb-sub"
      :class="{ 'tdb-sub--panel': openSubPanel }"
      data-toolbar-dropdown-sub="1"
      :data-floating-chain="subChain"
      role="menu"
      :aria-label="openSubItem.label"
      :style="{ left: subPos.left + 'px', top: subPos.top + 'px', minWidth: openSubPanel?.width || menuWidth, maxHeight: subMaxHeight == null ? undefined : subMaxHeight + 'px' }"
      @mouseenter="clearSubTimer"
      @mouseleave="openSubPanel ? scheduleClosePanel() : scheduleCloseSub()"
    >
      <!-- 内容（自定义组件 / render / 文字子项）由子面板统一渲染 -->
      <ToolbarDropdownSubPanel
        v-if="openSubContext"
        :node="openSubItem"
        :context="openSubContext"
        @pick="pickSub"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/* 触发器本身只占内容宽，不额外加面板/边框（观感由主题 button 决定） */
.tdb-trigger { display: inline-flex; }
.tdb-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}
/* 二级菜单是独立 fixed 浮层：z 走层叠带 token，绝不写裸数字 */
.tdb-sub {
  position: fixed;
  z-index: var(--layer-modal, 100000);
  background: var(--ui-overlay-solid, #fff);
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgb(0 0 0 / 0.08));
  /* 兜底：即使还没量到，也绝不超出视口；内容超高就在面板里滚 */
  max-height: calc(100vh - 16px);
  overflow-y: auto;
}
/* 自定义面板是内容块，点击它内部不该被当成「点外」；内边距交给面板自己控制 */
.tdb-sub--panel { padding: var(--tdb-panel-padding, 10px); }
.tdb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-badge, 6px);
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: var(--text-base, 13px);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.tdb-row:hover:not(:disabled), .tdb-row.is-active { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.tdb-row:disabled { opacity: 0.38; cursor: not-allowed; }
.tdb-row.is-danger { color: var(--ui-danger, #ef4444); }
.tdb-chev { color: var(--ui-ink-mute, #8c95a3); font-size: 14px; line-height: 1; }
@media (prefers-reduced-motion: reduce) {
  .tdb-row { transition: none !important; }
}
</style>
