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
 *
 * items 形状见 ToolbarMenuNode，children 非空 = 二级菜单（悬停或点击展开独立浮层）。
 */
import { computed, ref, onBeforeUnmount, onMounted } from 'vue'
import type { Component } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { floatingChainOf } from './floatingChain'
import type { ToolbarMenuNode } from './types'

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
    placement?: string
  }>(),
  {
    ariaLabel: undefined,
    icon: undefined,
    items: () => [],
    variant: 'ghost',
    active: undefined,
    disabled: false,
    menuWidth: '220px',
    placement: 'bottom-start',
  },
)

const emit = defineEmits<{
  (e: 'pick', key: string, path: string[]): void
}>()

const Button = useUiComponent('button')
const Dropdown = useUiComponent('dropdown')

const open = ref(false)
const openSubKey = ref<string | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

/** 二级菜单与主菜单卡片之间的固定间隔（px） */
const SUB_GAP = 8

/** 子菜单是独立浮层：定位以**主菜单卡片右边**为锚点，并留出间隔 */
const subPos = ref({ left: 0, top: 0 })
/**
 * 二级浮层的组链（父链 + 自己）。
 * 为什么必须有：主下拉的「点外关闭」只认 data-floating-chain —— 二级菜单是 teleport 到 body
 * 的独立元素，不写链就会被判成「点了外面」，点它的条目时父菜单先关、条目点击丢失。
 * 链直接从主面板元素的同名属性读（它就是父链），再追加自己的 id。
 */
const subChain = ref('')
let subTimer: ReturnType<typeof setTimeout> | null = null

function clearSubTimer(): void {
  if (subTimer) { clearTimeout(subTimer); subTimer = null }
}

function openSub(key: string, ev: MouseEvent): void {
  clearSubTimer()
  const row = ev.currentTarget as HTMLElement | null
  if (!row) return
  const r = row.getBoundingClientRect()
  const width = Number.parseInt(props.menuWidth, 10) || 220
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  /**
   * 锚点必须是**主菜单卡片**的右边，而不是这一行的右边：
   * 行右缘在主卡片内部（还有内边距），拿它 +4px 会让二级卡片压在主卡片上/贴死。
   * 右侧放不下就翻到主卡片左侧，同样留 SUB_GAP。
   */
  const main = row.closest('[data-toolbar-dropdown-menu="1"]') as HTMLElement | null
  const mainRect = main?.getBoundingClientRect() ?? null
  const parentChain = main?.dataset?.floatingChain ?? ''
  subChain.value = parentChain ? parentChain + ' tdb-sub' : 'tdb-sub'
  const rightEdge = mainRect ? mainRect.right : r.right
  const leftEdge = mainRect ? mainRect.left : r.left
  const left = rightEdge + SUB_GAP + width > vw - 8
    ? Math.max(8, leftEdge - SUB_GAP - width)
    : rightEdge + SUB_GAP
  subPos.value = { left, top: r.top }
  openSubKey.value = key
}

function scheduleCloseSub(): void {
  clearSubTimer()
  subTimer = setTimeout(() => { openSubKey.value = null }, 220)
}

const openSubItem = computed(() => props.items.find((i) => i.key === openSubKey.value) ?? null)

function pickLeaf(node: ToolbarMenuNode, path: string[]): void {
  if (node.disabled) return
  emit('pick', node.key, path)
  open.value = false
  openSubKey.value = null
}

function onRowClick(node: ToolbarMenuNode, path: string[], ev: MouseEvent): void {
  if (node.children?.length) { openSub(node.key, ev); return }
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
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
  clearSubTimer()
})

void floatingChainOf
void (Button as Component | undefined)
</script>

<template>
  <component :is="Dropdown || 'div'" v-model="open" :placement="placement" :offset="6"
    :menu-width="menuWidth" :teleport="true">
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
      <div class="tdb-menu" role="menu" :aria-label="title" data-toolbar-dropdown-menu="1">
        <button
          v-for="node in items"
          :key="node.key"
          class="tdb-row"
          :class="{ 'is-danger': node.danger, 'is-active': openSubKey === node.key || node.key === openSubKey }"
          type="button"
          role="menuitem"
          :aria-haspopup="node.children?.length ? 'menu' : undefined"
          :aria-expanded="node.children?.length ? openSubKey === node.key : undefined"
          :disabled="node.disabled"
          @mouseenter="node.children?.length ? openSub(node.key, $event) : scheduleCloseSub()"
          @click.stop="node.children?.length ? openSub(node.key, $event) : (pickLeaf(node, [node.key]), close())"
        >
          <span class="tdb-label">{{ node.label }}</span>
          <span v-if="node.children?.length" class="tdb-chev" aria-hidden="true">›</span>
        </button>
      </div>
    </template>
  </component>

  <!-- 二级菜单：独立浮层（不在主面板内部叠块） -->
  <Teleport to="body">
    <div
      v-if="open && openSubItem?.children?.length"
      class="tdb-menu tdb-sub"
      data-toolbar-dropdown-sub="1"
      :data-floating-chain="subChain"
      role="menu"
      :aria-label="openSubItem.label"
      :style="{ left: subPos.left + 'px', top: subPos.top + 'px', minWidth: menuWidth }"
      @mouseenter="clearSubTimer"
      @mouseleave="scheduleCloseSub"
    >
      <button
        v-for="child in openSubItem.children"
        :key="child.key"
        class="tdb-row"
        type="button"
        role="menuitem"
        :disabled="child.disabled"
        @click.stop="pickLeaf(child, [openSubItem.key, child.key])"
      >{{ child.label }}</button>
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
}
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
</style>
