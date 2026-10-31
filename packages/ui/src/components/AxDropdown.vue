<script setup lang="ts">
// AxDropdown —— 成品应用对 @mini-canvas/ui-kit Dropdown 的**薄适配层**。
//
// 用户口径（2026-10-03）：「你这个 drop down 组件，我看到好像你有多个实现方式……你必须在
// package UI 这个库里进行 drop down 组件的注册，优先级最高的地方会优先使用……
// 其他地方就可以正常地使用原来的这个组件，它会自动变成最新版本的」。
//
// 实践：**实现只有 ui-kit 一份**（定位 / 翻转 / 箭头 / 互斥 / 子浮层链 / 点外 / Esc 全在库里）。
// 本文件只做三件事：映射成品应用沿用的旧 props、保留 `.dd-menu` / `.axd-*` 公开外观钩子、
// 把 `openAtPoint`（右键 / 行尾按钮）转给库的 `showAtPoint`。
//
// 注册仍由 uiDropdownPlugin 写进 registryOf('ui') 的 dropdown 键（order -1 顶替主题默认件），
// 所有 useUiComponent('dropdown') 的插件与成品应用自己的底栏 / 状态栏 / 左抽屉都取到这一份。
import { computed, ref } from 'vue'
import { Dropdown as UiKitDropdown } from '@mini-canvas/ui-kit'
import { DROPDOWN_CLOSE_ALL_EVENT } from '@mini-canvas/canvas-render'

export type DropdownTrigger = 'click' | 'hover' | 'contextmenu'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    /** 方位：bottom / top / bottom-start / bottom-end ……（对齐也看后缀，显式 align 优先） */
    placement?: string
    offset?: number
    matchWidth?: boolean
    /** click 左键 | hover 悬停 | contextmenu 右键 */
    trigger?: DropdownTrigger
    hoverCloseDelay?: number
    menuWidth?: string
    menuMaxWidth?: string
    /** 浮层最大高度（超出滚动）；不写也会夹在视口内 */
    menuMaxHeight?: string
    /** 菜单外层 class（与默认样式合并） */
    menuClass?: string
    /** 内容区 class（与默认样式合并） */
    bodyClass?: string
    teleport?: boolean
    /** 要不要小箭头（贴着菜单的那条边，指向触发器）。默认开 */
    arrow?: boolean
    /** 内容对触发器的对齐：start / center / end；auto 保持 placement 后缀语义 */
    align?: 'start' | 'center' | 'end' | 'auto'
    /** 浮层 role（默认 menu；选项列表用 listbox） */
    menuRole?: string
    /** overlay-scroll（默认，整层滚）| inner-scroll（外框不滚，内容区自己滚） */
    layout?: 'overlay-scroll' | 'inner-scroll'
    /** 当作另一个浮层的子浮层（行尾菜单挂在列表旁）：由库续链、父关跟随 */
    nestedIn?: () => { chain: string; open: boolean } | undefined
  }>(),
  {
    modelValue: false,
    placement: 'bottom-start',
    offset: 6,
    matchWidth: false,
    trigger: 'click',
    hoverCloseDelay: 150,
    menuWidth: '',
    menuMaxWidth: '',
    menuMaxHeight: '',
    menuClass: '',
    bodyClass: '',
    teleport: true,
    arrow: true,
    align: 'auto',
    menuRole: 'menu',
    layout: 'overlay-scroll',
    nestedIn: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const kit = ref<InstanceType<typeof UiKitDropdown> | null>(null)
const nestedCtx = computed(() => props.nestedIn?.())
const parentChain = computed(() => nestedCtx.value?.chain ?? '')

/** 旧 props → ui-kit 的九宫格：显式 align 覆盖后缀，auto 时保留下缀含义。 */
const anchorPlacement = computed(() => {
  const side = props.placement.split('-')[0] || 'bottom'
  const suffix = props.placement.split('-')[1]
  if (props.align !== 'auto') return (side + '-' + props.align) as never
  if (suffix === 'start' || suffix === 'end') return (side + '-' + suffix) as never
  // 老 AxDropdown 的默认对齐是「居中」，无后缀时保持这个手感。
  return side as never
})

const menuClass = computed(() =>
  ['dd-menu', props.layout === 'inner-scroll' ? 'dd-menu--inner-scroll' : '', props.menuClass]
    .filter(Boolean)
    .join(' '),
)

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** 在鼠标点处打开（右键 / 行尾按钮）：转给 ui-kit，定位、翻转、互斥、关闭规则全部同一套。 */
function openAtPoint(x: number, y: number): void {
  kit.value?.showAtPoint(x, y)
}

defineExpose({ openAtPoint, chainId: computed(() => kit.value?.chainId), isOpen: open })
</script>

<template>
  <UiKitDropdown
    ref="kit"
    v-model="open"
    class="axd-root"
    :anchor-placement="anchorPlacement"
    :offset="offset"
    :match-width="matchWidth"
    :trigger="trigger"
    :hover-close-delay="hoverCloseDelay"
    :menu-min-width="menuWidth"
    :menu-max-width="menuMaxWidth"
    :menu-max-height="menuMaxHeight"
    :menu-class="menuClass"
    :body-class="bodyClass"
    :teleport="teleport"
    :arrow="arrow"
    :arrow-class="'axd-arrow'"
    :menu-role="menuRole"
    :layout="layout"
    :parent-chain="parentChain"
    :close-all-event="DROPDOWN_CLOSE_ALL_EVENT"
    :z-index="'var(--layer-modal, 100000)'"
  >
    <template #trigger="slotProps">
      <div class="axd-trigger"><slot name="trigger" v-bind="slotProps" /></div>
    </template>
    <template #default="slotProps"><slot v-bind="slotProps" /></template>
  </UiKitDropdown>
</template>

<style>
/* 非 scoped：菜单被 Teleport 到 body，scoped 选择器命不中。
   浮层类名 dd-menu / axd-arrow 是公开外观契约（调用方与浏览器回归按它们认件）。 */
.axd-root { display: inline-flex; text-align: left; }
/* 触发器是 .axd-root（inline-flex）的 flex 项目：宿主把 root 拉宽时它也跟着宽。 */
.axd-trigger { display: block; flex: 1 1 auto; min-width: 0; }
/* 箭头颜色跟默认面板（--dd-bg）走，而不是库里的 --ui-panel：宿主浮层用不透明白底。 */
.mck-dropdown__arrow.axd-arrow {
  --mck-dropdown-arrow-bg: var(--dd-bg, var(--ui-overlay-solid));
  --mck-dropdown-arrow-line: var(--ui-line);
}
</style>
