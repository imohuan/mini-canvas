<script setup lang="ts">
// AxSubMenu —— 菜单里的**二级菜单**（组件嵌套，不手写浮层）。
//
// 定位、翻转、防出屏、父链续接、跟父菜单一起关闭，全部由 @mini-canvas/ui-kit 的 Dropdown 负责
// （`anchor` 指向这一行、`parentChain` 交给库续链）。本文件只提供菜单行的外观与“选中即收起”的语义。
//
// 用法（放在 AxMenu 里的一行）：
//   <AxSubMenu label="移动到" :items="[{ key: '', label: '个人资产库' }, ...]" @pick="onPick" />
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { Dropdown } from '@mini-canvas/ui-kit'
import { floatingChainOf } from './hooks/floatingGroup'

export interface AxSubMenuItem {
  key: string
  label: string
  /** 左侧缩进（层级/深度），px */
  indent?: number
  /** 选中态（带勾） */
  active?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    items: AxSubMenuItem[]
    /** 展开方向：right（默认，往右）| left */
    side?: 'right' | 'left'
    /** 菜单最小宽度 */
    menuWidth?: string
    menuMaxHeight?: string
    /** 行尾的 › 提示（默认显示） */
    hint?: boolean
  }>(),
  { side: 'right', menuWidth: '180px', menuMaxHeight: '320px', hint: true },
)
const emit = defineEmits<{ pick: [key: string] }>()

const rowRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
/** 父链在打开时现读：行必须先挂进父面板，才读得到它的链。 */
const parentChain = ref('')
/** 行与面板之间有一小段空隙：离开行后等一会儿再关，给鼠标穿过去的时间。 */
let closeTimer = 0

function open(): void {
  cancelClose()
  parentChain.value = floatingChainOf(rowRef.value).join(' ')
  isOpen.value = true
}

function scheduleClose(): void {
  cancelClose()
  closeTimer = globalThis.setTimeout(() => { isOpen.value = false }, 260) as unknown as number
}

function cancelClose(): void {
  globalThis.clearTimeout(closeTimer)
  closeTimer = 0
}

/** 选中某一项：交给调用方处理，然后收起面板。 */
function pick(key: string): void {
  emit('pick', key)
  isOpen.value = false
}

const placement = computed(() => (props.side === 'left' ? 'left-start' : 'right-start'))

defineExpose({ open, close: () => { isOpen.value = false }, pick })

onBeforeUnmount(cancelClose)
</script>

<template>
  <Dropdown
    v-model="isOpen"
    :anchor="rowRef"
    :anchor-placement="placement"
    :offset="4"
    trigger="always"
    close-all-event="mini-canvas:dropdown-close-all"
    :menu-min-width="menuWidth"
    :menu-max-height="menuMaxHeight"
    :parent-chain="parentChain"
    menu-class="dd-menu ax-sub-menu"
    :z-index="'var(--layer-modal, 100000)'"
  >
    <template #trigger>
      <div
        ref="rowRef"
        class="ax-sub-row"
        @mouseenter="open"
        @mouseleave="scheduleClose"
        @click="open"
      >
        <div class="ax-menu-item" role="menuitem" aria-haspopup="menu" :aria-expanded="isOpen">
          <slot name="label">{{ label }}</slot>
          <ChevronRight v-if="hint" class="ax-menu-hint" :size="12" aria-hidden="true" />
        </div>
      </div>
    </template>
    <template #default="{ close }">
      <div @mouseenter="cancelClose" @mouseleave="scheduleClose">
        <slot :pick="pick" :close="close">
          <button
            v-for="it in items"
            :key="it.key"
            class="ax-menu-item"
            role="menuitem"
            :class="{ 'is-active': it.active }"
            :style="it.indent ? { paddingLeft: it.indent + 'px' } : undefined"
            @click="pick(it.key)"
          >{{ it.label }}</button>
        </slot>
      </div>
    </template>
  </Dropdown>
</template>

<style>
/* 非 scoped：浮层 teleport 到 body；类名沿用设计系统的 .ax-menu-item 公开契约。 */
.ax-sub-row { display: flex; }
.ax-sub-menu { min-width: 160px; }
.ax-sub-menu .ax-menu-item { min-height: 32px; }
</style>
