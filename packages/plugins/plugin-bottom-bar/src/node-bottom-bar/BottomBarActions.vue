<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ToolParamDef } from '@plume-canvas/kernel'
import { useUiComponent } from '@plume-canvas/canvas-render'
import type { AiActionConfig } from '../aiActions'
import type { ModelIcon } from './modelIcons'
import { ICON_AI_MORE, ICON_AT } from './icons'
import HtmlPanelFrame from './HtmlPanelFrame.vue'
import { paramSummary as summaryOf } from './paramSummary'
import { selectsBudget } from './selectsWidth'
import { resolveBottomRow } from './bottomRowLayout'

const props = defineProps<{
  id: string
  currentId: string
  currentActionLabel: string
  running: boolean
  paramDefs: ToolParamDef[]
  values: Record<string, unknown>
  aiButtons: Array<AiActionConfig & { icon: string }>
  aiRunningId: string | null
  /** 仅用于无障碍播报（失败原因的可见提示走全局 notify，用户 2026-11-20） */
  aiError: string
  showEditor: boolean
  charCount: number
  charLimit: number
  invalidHint: string
  canRun: boolean
  submitted: boolean
  currentActionTitle: string
  iconWarn: string
  iconSend: string
  actionOptions: Array<{ value: string; label: string; model: ModelIcon }>
  /** 参数区交给 provider 的 HTML 面板时，不再画默认的参数摘要按钮 */
  hideParams?: boolean
  /** provider 自带的 HTML 参数面板（有输入框时放进「参数」下拉里） */
  panelHtml?: string
  /** 传给 HTML 面板的主题色 */
  panelTheme?: Record<string, string>
  /** 当前动作的模型图标（触发器左侧），没有动作时为 null */
  currentModelIcon: ModelIcon | null
  /** 是否用 Agent 的模型选择器代替动作下拉（文本节点） */
  hasModelPicker?: boolean
  /**
   * provider 算出来的参数标题（用户 2026-11-17）。
   *
   * 给了就用它，没给就用现有摘要 —— 这样老 provider 的表现一点不变，
   * 新 provider 可以把「当前这一档花多少积分」写进下拉标题。
   */
  paramLabel?: string
  /**
   * 发送按钮上的文字（用户 2026-11-17）。
   *
   * 典型值是「0.65积分」。空串 = 只画图标（与从前一致）。
   */
  sendLabel?: string
  /**
   * 最多直接显示几个 AI 按钮，其余收进「更多」下拉（用户 2026-11-18）。
   *
   * 来自配置「布局/控制栏 · 底栏 AI 按钮显示个数」，默认 2。
   */
  aiVisibleCount?: number
}>()

const emit = defineEmits<{
  actionPicked: [value: string | number]
  fieldChange: [key: string, value: string | number | boolean]
  aiClick: [action: AiActionConfig]
  /** 最左侧「@」按钮：在光标处插入一个 @（会直接打开编辑器的 @ 下拉） */
  insertAt: []
  run: []
  /** HTML 参数面板里改了参数（可能一次多个） */
  panelValues: [values: Record<string, unknown>]
  /** HTML 参数面板要提示一句 */
  panelNotify: [payload: { level: 'info' | 'success' | 'error'; message: string }]
}>()

/**
 * 两个下拉那一行的“宽度预算”（用户 2026-11-16）：
 * 整行可用宽 − 右侧按钮区宽 → 才轮到两个下拉分。
 *
 * 为什么要真的量：右侧按钮数随动作变（有的动作有翻译/优化两个 AI 按钮，有的没有），
 * 写死 px 就会在按钮多时把下拉挤成省略号。量完写进 CSS 变量，两格的 max-width 用它。
 */
const bottomRow = ref<HTMLElement | null>(null)
const actionsBox = ref<HTMLElement | null>(null)
const selectsBox = ref<HTMLElement | null>(null)
const modelMax = ref(280)
const paramMax = ref(240)
const paramMin = ref(0)
/** 模型那格的下限：读得清的最短宽，与 paramMin 一起决定「换行还是压缩」 */
const modelMin = ref(0)
/**
 * 这一行是「左右同排」还是「右侧换到第二行」（用户 2026-11-18）。
 *
 * 以前是想让 flex 自己 wrap：结果空间明明够，也会因为各种 min-width 打架而折行；
 * 空间不够时又先压字。现在由 JS 算一次「放得下吗」，只在这两种模式之间切。
 */
const stacked = ref(false)
/**
 * 左侧「@ + 模型 + 参数 + 预设」这一组**至少要占多宽**。
 *
 * 用它当 .nb-selects 的 min-width（用户 2026-11-17）：
 * 右侧 AI 按钮再多，也只能换到下一行，绝不能把这里的字压成「GPT Imag…」。
 */
const selectsMin = ref(240)
/**
 * 两个下拉**当前显示的原文**（用户 2026-11-17）。
 *
 * 宽度预算要用「文字本身有多长」来算，而不是量当前布局 ——
 * 量布局会和算出来的宽形成循环，越算越窄。
 */
const modelTriggerText = computed(() => {
  const hit = props.actionOptions.find((o) => o.value === props.currentId)
  return hit?.label ?? props.currentActionLabel ?? ''
})
let budgetObserver: ResizeObserver | null = null
/** 观察右侧按钮区里每个子元素（AI 按钮 / 更多 / 字数 / 发送）的宽高变化 */
let actionsChildrenObserver: ResizeObserver | null = null
/** 右侧按钮区的子节点增删（AI 按钮开关、更多菜单出现/消失） */
let actionsMutationObserver: MutationObserver | null = null

/**
 * 换行状态下右侧整块是 **flex-basis:100%**，它的盒子宽恒等于整行 ——
 * 于是只观察 .nb-actions 本身，永远收不到「右侧内容变少、可以回到一行」的信号。
 * 用户 2026-11-20 截图：错误短句消失后，底栏仍停在两行。
 *
 * 这里额外盯住右侧的每个子元素与子节点增删，任何一处变化都重新算一次预算。
 */
function observeActionsChildren(): void {
  actionsChildrenObserver?.disconnect()
  actionsMutationObserver?.disconnect()
  const box = actionsBox.value
  if (!box) return
  if (typeof ResizeObserver !== 'undefined') {
    actionsChildrenObserver ??= new ResizeObserver(() => measureBudget())
    for (const child of Array.from(box.children)) actionsChildrenObserver.observe(child)
  }
  const MO = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver
  if (MO) {
    actionsMutationObserver ??= new MO(() => {
      observeActionsChildren()
      measureBudget()
    })
    actionsMutationObserver.observe(box, { childList: true })
  }
}

/**
 * 一个元素「不被压缩时」的宽。
 *
 * 为什么不能只用 getBoundingClientRect：右侧按钮区是 flex:0 1 auto，
 * 被左侧挤扁时 rect.width 会变成 0，于是下一轮算出「右侧不占地方」，
 * 左侧就更大 —— 越算越糟（用户 2026-11-18 现场：actions 宽 0）。
 * scrollWidth 记录的是内容本身要的宽，压扁了也不会变小。
 */
function naturalWidth(el: Element | null | undefined): number {
  if (!(el instanceof HTMLElement)) return 0
  return Math.max(0, el.getBoundingClientRect().width, el.scrollWidth)
}

/** 容器里所有直接子元素自然宽之和 + 它们之间的 gap */
function rowChildrenWidth(box: HTMLElement): number {
  const style = getComputedStyle(box)
  const gap = Number.parseFloat(style.columnGap || style.gap || '0') || 0
  const kids = Array.from(box.children) as HTMLElement[]
  let sum = 0
  for (const el of kids) sum += naturalWidth(el)
  return sum + Math.max(0, kids.length - 1) * gap
}

/**
 * 行内**不由两个下拉分享**的固定宽度：最左侧的 @ 按钮、两条分隔线、以及它们之间的 gap。
 *
 * 量真实元素而不是写常数：按钮尺寸、分隔线间距都跟着主题走，
 * 写死 30 / 1 / 4 这种数字，换个主题就会少扣或多扣（用户 2026-11-17 实测被裁 50px）。
 */
function fixedChromeWidth(): number {
  const selects = selectsBox.value
  if (!selects) return 0
  /*
   * 只累加**两格之外**的东西（预设按钮）+ 子元素之间的 gap。
   *
   * 从前是「selects 总宽 − 两格宽」：而 selects 是 flex:1，会把整行的余量
   * 都算成"固定件"，于是 min-width 一路涨到整行、把右侧挤没（用户 2026-11-18）。
   */
  const style = getComputedStyle(selects)
  const innerGap = Number.parseFloat(style.columnGap || style.gap || '0') || 0
  const kids = Array.from(selects.children) as HTMLElement[]
  let insideSelects = Math.max(0, kids.length - 1) * innerGap
  for (const el of kids) {
    if (el.classList.contains('nb-field')) continue
    insideSelects += naturalWidth(el)
  }
  /*
   * 还要加上**.nb-selects 之外**的固定件（最左侧 @ 按钮）。
   *
   * 漏掉它时预算多算 30px：两个下拉都按「够用」给宽，实际放不下就折行
   *（用户 2026-11-17 截图：模型一行、参数一行，底栏无谓变高）。
   */
  const at = bottomRow.value?.querySelector(':scope > .nb-at-btn')
  const atWidth = naturalWidth(at)
  /*
   * 只有「@ 按钮确实和这一行同排」时才扣它。
   *
   * 实测（用户 2026-11-17）：切换动作 / 窗口尺寸时 @ 按钮可能被挤到别的行，
   * 这时再扣它 30px 就会算少 —— 模型名于是被压到 120px 只剩「GPT I…」。
   */
  const atSameRow = at instanceof HTMLElement && bottomRow.value instanceof HTMLElement
    ? Math.abs(at.getBoundingClientRect().top - bottomRow.value.getBoundingClientRect().top) < 8
    : false
  if (!atSameRow || atWidth <= 0) return insideSelects
  // @ 按钮与 selects 之间的行内 gap（.nb-bottom 的 column-gap）也要扣
  const rowStyle = getComputedStyle(bottomRow.value as HTMLElement)
  const rowGap = Number.parseFloat(rowStyle.columnGap || rowStyle.gap || '0') || 0
  return insideSelects + atWidth + rowGap
}

function measureBudget(): void {
  const row = bottomRow.value
  if (!row) return
  /*
   * 计算收在 bottomRowLayout.ts（纯函数，有单测覆盖各种宽度组合）：
   * 这里只负责量「实际可用宽」并写进响应式变量。
   */
  const layout = resolveBottomRow({
    rowWidth: row.clientWidth,
    // 用「子元素自然宽之和」，被挤扁时不会量成 0（否则越算越窄）
    actionsWidth: actionsBox.value ? rowChildrenWidth(actionsBox.value) : 0,
    fixedWidth: fixedChromeWidth(),
    /*
     * 触发器上的**真实文字**（用户 2026-11-21）。
     *
     * 以前用 props 里的标题估算：Agent 的生成动作、带账号名的模型名都可能和
     * 实际渲染出来的不一样，估少了就会把「本地多图」这种短名字也截成「本地…」。
     * 现在优先量页面上真正渲染的文字，量不到才回落到 props。
     */
    modelText: liveTextOf('.nb-field--action .nb-model-trigger-label')
      || modelTriggerText.value || props.currentActionLabel || '',
    paramText: liveTextOf('.nb-field--params .tpg-text, .nb-field--params .nb-param-text')
      || paramTriggerText.value || props.paramLabel || '',
  })
  // 值没变就不写回：避免 ResizeObserver 被自己的写入再触发一次
  if (
    layout.modelWidth === modelMin.value &&
    layout.paramWidth === paramMin.value &&
    layout.selectsMin === selectsMin.value &&
    layout.stacked === stacked.value
  ) return
  modelMax.value = layout.modelWidth
  modelMin.value = layout.modelWidth
  paramMax.value = layout.paramWidth
  paramMin.value = layout.paramWidth
  selectsMin.value = layout.selectsMin
  stacked.value = layout.stacked
}

/** 一个格子「内容不被裁时」需要的宽度（含内部 padding）；量不到返回 0 */
/**
 * 一格「内容不被裁时」需要多宽（用户 2026-11-17）。
 *
 * 分两步：
 * 1. 有真实文字节点（下拉自己的 label / 参数标题）→ 量它的 scrollWidth；
 * 2. 没有（Agent 模型选择器那种复合按钮）→ 用文字估算：
 *    14px 字号的中文/英文混排，经验上每字约 7px，再加图标 / 箭头 / padding 的固定件。
 *
 * 估算只用在「没有可量对象」的兜底上，所以宁可给宽一点：
 * 给宽了只是右侧换行，给窄了就会裁字 —— 用户 2026-11-17 反复报的就是后者。
 */
function measuredNeed(partSelector: string, fallbackText: string): number {
  const box = selectsBox.value?.querySelector(partSelector)
  if (!(box instanceof HTMLElement)) return 0
  const measured = naturalWidthOf(box)
  if (measured > 0) return measured
  const estimate = Math.ceil(String(fallbackText ?? '').length * 7.2) + 54
  return Math.max(0, estimate)
}

function naturalWidthOf(el: Element | null | undefined): number {
  if (!(el instanceof HTMLElement)) return 0
  const inner = el.querySelector<HTMLElement>('.tpg-trigger, .nb-param-trigger, [data-slot="select-trigger"]') ?? el
  const extra = el.getBoundingClientRect().width - inner.getBoundingClientRect().width
  /*
   * 多留 4px 缓冲：scrollWidth 是整数、max-width 取整会向下，差 1px 就触发换行／裁字。
   * 用户 2026-11-17 实测：「1.17积分」的最后一个字反复被吃掉。
   */
  /*
   * 量**最内层文字**的真实宽，而不是外层按钮的 scrollWidth。
   *
   * 实测（用户 2026-11-17）：外层的 scrollWidth 把图标、箭头、padding 都算进去，
   * 用它可以少给 / 多给；真正不能截断的是 .tpg-text 那一段（「4K · 1:1 · 1.17积分」）。
   */
  const text = inner.querySelector<HTMLElement>('.tpg-text, .nb-param-text, .nb-model-trigger-label')
  if (text) {
    /*
     * 被压扁时 scrollWidth 才是「本来需要多宽」（clientWidth 是现在多宽）。
     * 但 scrollWidth 对 white-space:nowrap 的 span 有时等于 clientWidth，
     * 所以两种取大者。
     */
    const innerChrome = inner.getBoundingClientRect().width - text.getBoundingClientRect().width
    return Math.max(0, text.scrollWidth + Math.max(0, innerChrome) + Math.max(0, extra) + 4)
  }
  return Math.max(0, inner.scrollWidth + Math.max(0, extra) + 4)
}

/**
 * 页面上「现在真正显示的那段文字」。
 *
 * 为什么不用 props：模型名可能带账号后缀、生成动作的标题来自 provider，
 * props 与真实渲染并不总是一致；宽度预算必须按看得见的那一行算。
 */
function liveTextOf(selector: string): string {
  const el = selectsBox.value?.querySelector(selector)
  return el instanceof HTMLElement ? (el.textContent ?? '').trim() : ''
}

onMounted(() => {
  measureBudget()
  observeActionsChildren()
  if (typeof ResizeObserver === 'undefined') return
  budgetObserver = new ResizeObserver(() => measureBudget())
  if (bottomRow.value) budgetObserver.observe(bottomRow.value)
  if (actionsBox.value) budgetObserver.observe(actionsBox.value)
  if (selectsBox.value) budgetObserver.observe(selectsBox.value)
})
onBeforeUnmount(() => {
  budgetObserver?.disconnect()
  budgetObserver = null
  actionsChildrenObserver?.disconnect()
  actionsChildrenObserver = null
  actionsMutationObserver?.disconnect()
  actionsMutationObserver = null
})

/**
 * 影响宽度的输入变了就重算一次（用户 2026-11-20：右侧内容变少后 UI 仍停在两行）。
 *
 * 换行时右侧整块的盒子宽恒等于整行，只靠 ResizeObserver 收不到「内容变少」；
 * 这里把真正决定宽度的 props 列出来，变化后下一帧再量。
 */
watch(
  () => [
    props.aiButtons.map((a) => a.id).join('|'),
    props.aiError,
    props.aiRunningId,
    props.aiVisibleCount,
    props.charCount,
    props.sendLabel,
    props.paramLabel,
    props.currentId,
    props.currentActionLabel,
  ],
  () => void nextTick(() => measureBudget()),
)

/**
 * 参数摘要：只显示**改过默认值**的那些（用户 2026-11-16：没必要显示每一个选项的值）。
 *
 * 全部用默认值时显示「参数 5」而不是「MP3 · 24 kHz · 0 · 0 · 0」——
 * 后者会把左边的模型名挤成省略号，也读不出哪个是重点。
 */
const paramSummary = computed(() =>
  summaryOf({ fields: props.paramDefs, values: props.values ?? {}, placeholder: '参数' }),
)
/**
 * 参数下拉上真正显示的标题。
 *
 * provider 用 selectLabel 算出了文案（例如带花费）就优先用它；
 * 否则仍然是现有摘要 —— 默认表现不变（用户 2026-11-17）。
 */
const paramTitle = computed(() => {
  const custom = (props.paramLabel ?? '').trim()
  return custom !== '' ? custom : paramSummary.value
})
/** 参数触发器上显示的文字（宽度预算与 paramTitle 用同一份，避免两处不一致） */
const paramTriggerText = paramTitle

/**
 * 发送按钮里的文字（用户 2026-11-17）。
 *
 * 去掉首尾空白；全空的就是「只画图标」，按钮尺寸与从前一致。
 */
const sendText = computed(() => (props.sendLabel ?? '').trim())

/**
 * 发送按钮的悬停提示（用户 2026-11-18）：说明这次点下去会做什么。
 *
 * 说明放气泡里、花费留在按钮文字上 —— 按钮宽度只跟钱数有关，不会再被一句话撑长。
 */
const sendTip = computed(() => {
  const title = (props.currentActionTitle ?? '').trim()
  if (props.submitted) return '已提交，等结果'
  if (!props.canRun) return title || '当前还不能发送'
  if (title && sendText.value) return title + ' · ' + sendText.value
  return title || (sendText.value ? '生成 · ' + sendText.value : '生成')
})

/**
 * AI 按钮的「直接显示 / 折叠」切分（用户 2026-11-18）。
 *
 * 用户口径：「如果超过 2 个 ai 底栏按钮你就直接折叠，固定显示多少个可以在配置里调」。
 * 所以这里不按剩余空间算，只按配置个数切 —— 布局因此稳定，不会随窗口宽度抖动。
 */
const aiSplit = computed(() => {
  const all = props.aiButtons ?? []
  const limit = Math.max(0, Math.floor(props.aiVisibleCount ?? 2))
  return { visible: all.slice(0, limit), overflow: all.slice(limit) }
})
/**
 * 面板内容的自然高度（由 iframe 报上来）。
 * 用来给外层 ScrollArea 一个确定高度：短内容刚好贴住，长内容封顶后滚动。
 */
const panelHeight = ref(240)
/** 参数下拉的开关状态：受控之后箭头能跟着转，点空白 / Esc 由组件库关掉 */
const paramOpen = ref(false)

/**
 * 参数面板里的「二次点击」不该关面板（用户 2026-11-18 报的 BUG）。
 *
 * 场景：面板里再开一个下拉（分辨率 / 质量…），点它的触发器想收起那一项时，
 * 外层 Popover 把这次点击判成「点了面板外面」，于是整个参数面板一起消失 ——
 * 表现就是「同一个下拉的 trigger 点第二次，整个菜单没了」。
 *
 * 判据：点击目标还在面板里（或它弹出的浮层里）就放行，不关外层。
 * 浮层是 portal 出去的，不在面板 DOM 树内，所以同时检查 data-slot 里带 popover /
 * dropdown / select 内容的节点 —— 它们都带 [data-dismissable-layer] 或 role=listbox。
 */
function isInsideParamPanel(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.nb-param-pop')) return true
  // portal 出来的二级浮层：只要这次点击落在任何浮层内容里，就不算"点了外面"
  return Boolean(
    target.closest(
      '[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"], [role="listbox"], [role="menu"]',
    ),
  )
}

function onParamInteractOutside(e: Event): void {
  if (isInsideParamPanel(e.target)) e.preventDefault()
}

function onParamPointerDownOutside(e: Event): void {
  if (isInsideParamPanel(e.target)) e.preventDefault()
}

/**
 * 焦点跑到面板里（用户 2026-11-18「点第二个下拉就整个面板消失」）。
 *
 * 面板正文在 iframe 里，点里面的二级下拉时焦点会落到 iframe 上。
 * Reka 把「点外面」「焦点跑到外面」分成两个事件，只拦指针那一支挡不住这个。
 */
function onParamFocusOutside(e: Event): void {
  if (isInsideParamPanel(e.target)) e.preventDefault()
}

const ToolParamGroup = useUiComponent('toolParamGroup')
const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverTrigger = useUiComponent('PopoverTrigger')
const PopoverContent = useUiComponent('PopoverContent')
const ScrollArea = useUiComponent('ScrollArea')
/**
 * 模型下拉改用 DropdownMenu（用户 2026-11-06 指定）。
 *
 * 为什么不再用 Select：底栏浮在画布上，为了「点画布不被遮住」关掉了 body-lock 与
 * outside-pointer-events；而 reka 的 Select 在触发器上再点一下不会切回关闭，
 * 点空白也不走它自己的 outside 关闭链 —— 用户实测「展开后点 trigger 收不回去、
 * 点空白也不消失」。DropdownMenu 的触发器点击本身就是「开/关切换」，点外关闭也是
 * 菜单自己的标准行为，正是这里需要的交互。
 */
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')
const DropdownMenuLabel = useUiComponent('DropdownMenuLabel')

/** 当前模型名（触发器文字；没选到动作时给一句提示） */
const triggerLabel = computed(() => props.currentActionLabel || '选择模型')

function pickAction(value: string): void {
  if (value === props.currentId) return
  emit('actionPicked', value)
}
</script>

<template>
  <div class="nb-bottom" ref="bottomRow" :class="{ 'is-stacked': stacked }"
    :style="{
      '--nb-model-max': modelMax + 'px',
      '--nb-model-min': modelMin + 'px',
      '--nb-param-max': paramMax + 'px',
      '--nb-param-min': paramMin + 'px',
      '--nb-selects-min': selectsMin + 'px',
    }">
    <!--
      最左侧的 @ 按钮（用户 2026-11-06 图 2）。
      只做一件事：往输入框光标处塞一个 @ 字符，@ 菜单由编辑器自己弹出。
    -->
    <TooltipProvider :delay-duration="220">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-xs"
            class="nb-icon-btn nb-at-btn"
            type="button"
            data-testid="bar-insert-at"
            aria-label="插入 @ 引用素材"
            :disabled="!showEditor"
            @click.stop="emit('insertAt')"
          >
            <span aria-hidden="true" v-html="ICON_AT" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" :arrow="true">插入 @ 引用素材</TooltipContent>
      </Tooltip>
    </TooltipProvider>
      <div class="nb-selects" ref="selectsBox">
      <div class="nb-field nb-field--action">
        <!-- 文本节点：模型来自 Agent 配置（用户 2026-11-07）；面板主体复用 Agent 的 ModelPicker -->
        <slot name="model-picker" />
        <!--
          模型下拉 = DropdownMenu（用户 2026-11-06 指定）：
          触发器点击即开/关切换，点画布空白由菜单自己的 outside 关闭处理。
        -->
        <DropdownMenu v-if="!hasModelPicker">
                <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm"
              :id="'nb-action-' + id"
              class="nb-action-select nb-model-trigger"
              type="button"
              :disabled="running"
              aria-label="选择动作 / 模型"
            >
              <span v-if="currentModelIcon" class="nb-model-badge" :data-tone="currentModelIcon.tone"
                aria-hidden="true" v-html="currentModelIcon.svg" />
              <span class="nb-model-trigger-label">{{ triggerLabel }}</span>
              <svg class="nb-model-trigger-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>
                </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" class="nb-action-menu nb-model-menu">
            <DropdownMenuItem
              v-for="o in actionOptions"
              :key="o.value"
              class="nb-model-item"
              :data-state="o.value === currentId ? 'checked' : undefined"
              @select="pickAction(String(o.value))"
            >
              <span class="nb-model-badge" :data-tone="o.model.tone" aria-hidden="true" v-html="o.model.svg" />
              <span class="nb-model-item-label">{{ o.label }}</span>
              <svg v-if="o.value === currentId" class="nb-model-item-check" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span class="nb-divider" aria-hidden="true" />
      <!-- provider 自带 HTML 面板：作为「参数」下拉的内容（用户口径：面板属于下拉菜单，不该压在输入框上方） -->
      <div v-if="panelHtml" class="nb-field nb-field--params">
        <Popover v-model:open="paramOpen">
                <PopoverTrigger as-child>
            <button
              type="button"
              class="nb-param-trigger"
              :aria-expanded="paramOpen"
              :disabled="running"
              :aria-label="paramTitle || '参数'"
              aria-haspopup="dialog">
              <span class="nb-param-glyph" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /></svg>
              </span>
              <span class="nb-param-text">{{ paramTitle || '参数' }}</span>
              <svg class="nb-param-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
                </PopoverTrigger>
          <PopoverContent
            align="end"
            :side-offset="4"
            :collision-padding="12"
            class="nb-param-pop"
            :style="{ '--nb-panel-h': panelHeight + 'px' }"
            @pointer-down-outside="onParamPointerDownOutside"
            @interact-outside="onParamInteractOutside"
            @focus-outside="onParamFocusOutside"
          >
            <!--
              滚动交给 shadcn 的 ScrollArea（用户口径 2026-11-07）：
              iframe 本身不限高，把内容的真实高度报上来；超过 popover 高度时由这里滚。
              不这样做的后果：iframe 里长出一个原生滚动条，和外层两套滚动打架，
              观感就是截图里那条灰长条 + 面板被截断。
              另外：
              type="always"：滚动条常驻。
              面板内容是 iframe，高度是量完之后才写进去的；Reka 默认 `auto` 在挂载那一刻
              量不到溢出，就永远不渲染 ScrollBar（用户 2026-11-07：只剩一条原生滚动条）。
              常驻之后滚动条由组件库画，原生那条已经由组件库的样式藏掉。
            -->
            <ScrollArea type="always" class="nb-param-scroll">
              <HtmlPanelFrame
                :html="panelHtml"
                :values="values"
                :params="paramDefs"
                :action-id="currentId"
                :model="currentActionLabel"
                :disabled="running"
                :theme="panelTheme"
                @height="(h: number) => (panelHeight = h)"
                @set-values="(v: Record<string, unknown>) => emit('panelValues', v)"
                @run="emit('run')"
                @notify="(p: { level: 'info' | 'success' | 'error'; message: string }) => emit('panelNotify', p)"
              />
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>
      <div v-else-if="paramDefs.length > 0 && !hideParams" class="nb-field nb-field--params">
        <ToolParamGroup
          :params="paramDefs"
          :values="values"
          :disabled="running"
          :id-prefix="'nb-group-' + id"
          :title="props.paramLabel ?? ''"
          @change="(key: string, v: string | number | boolean) => emit('fieldChange', key, v)"
        />
      </div>
      <!-- 参数区之后的扩展位（预设提示词等按钮挂这里，见 BottomBarPresets） -->
      <slot name="presets" />
    </div>
    <div class="nb-actions" ref="actionsBox">
      <!--
        AI 按钮的说明走 shadcn Tooltip（用户 2026-11-18）。

        以前挂的是浏览器原生 title：延迟半秒、样式跟系统走，和界面不搭。
        这里每个按钮包一层 TooltipProvider，气泡在上方（底栏贴屏幕下缘）。
        触发器仍是按钮本身（TooltipTrigger as-child），不额外套包裹层 ——
        这样它和这些按钮上的点击 / 焦点行为都不会打架。
      -->
      <TooltipProvider
        v-for="ai in aiSplit.visible"
        :key="ai.id"
        :delay-duration="220"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm"
              class="nb-icon-btn"
              :class="{ 'is-running': aiRunningId === ai.id }"
              type="button"
              :disabled="!showEditor || aiRunningId !== null"
              :aria-label="ai.name"
              @click.stop="emit('aiClick', ai)"
            >
              <span v-if="aiRunningId === ai.id" class="nb-ai-spinner" aria-hidden="true" />
              <span v-else aria-hidden="true" v-html="ai.icon" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" :arrow="true" class="nb-tip">
            <span class="nb-tip-title">{{ ai.name }}</span>
            <span v-if="ai.description" class="nb-tip-desc">{{ ai.description }}</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <!--
        AI 按钮超过配置个数时收进「更多」（用户 2026-11-18）。
        按钮本身仍是同一个 .nb-icon-btn，视觉与其它 AI 按钮一致。
      -->
      <DropdownMenu v-if="aiSplit.overflow.length > 0">
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-sm"
                  class="nb-icon-btn nb-ai-more"
                  type="button"
                  data-testid="bar-ai-more"
                  :disabled="aiRunningId !== null"
                  :aria-label="'更多 AI 功能（' + aiSplit.overflow.length + '）'"
                  aria-haspopup="menu"
                >
                  <span aria-hidden="true" v-html="ICON_AI_MORE" />
                </Button>
              </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" class="nb-action-menu nb-ai-more-menu">
          <!--
            菜单标题（用户 2026-11-18）：以前展开是一列光秃秃的图标，看不出这组是干什么的。
          -->
          <DropdownMenuLabel class="nb-ai-more-title">AI 工具</DropdownMenuLabel>
          <!--
            菜单项的说明改走 Tooltip（用户 2026-11-18）。

            以前把描述直接排进菜单行：名字被挤成「阿…」、描述也被截成「sda fsad fasd阿…」，
            两样都读不全。现在行里只留图标 + 名字，描述在悬停时出气泡。

            disable-hoverable-content：鼠标移到气泡上时不再把它当成"离开了菜单项"，
            菜单不会因此闪一下；Tooltip 的触发器是行内的名字块，不是菜单项本身，
            所以点选行为完全不受影响。
          -->
          <TooltipProvider :delay-duration="260" disable-hoverable-content>
            <DropdownMenuItem
              v-for="ai in aiSplit.overflow"
              :key="ai.id"
              class="nb-model-item"
              :disabled="!showEditor || aiRunningId !== null"
              @select="emit('aiClick', ai)"
            >
              <Tooltip>
                <TooltipTrigger as-child>
                  <span class="nb-ai-more-item">
                    <span class="nb-model-badge" aria-hidden="true" v-html="ai.icon" />
                    <span class="nb-model-item-label">{{ ai.name }}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent v-if="ai.description" side="right" :arrow="true" class="nb-tip">
                  <span class="nb-tip-desc">{{ ai.description }}</span>
                </TooltipContent>
              </Tooltip>
            </DropdownMenuItem>
          </TooltipProvider>
        </DropdownMenuContent>
      </DropdownMenu>
      <!-- 失败原因只给读屏播报（视觉提示走全局 notify，用户 2026-11-20）；不占行内宽度 -->
      <span v-if="aiError" class="sr-only" role="alert">{{ aiError }}</span>
      <!-- 字数统计也不再挂原生 title（用户 2026-11-18） -->
      <TooltipProvider :delay-duration="220">
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="nb-count" tabindex="0">{{ charCount }}/{{ charLimit }}</span>
          </TooltipTrigger>
          <TooltipContent side="top" :arrow="true">最多 {{ charLimit }} 字</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div class="nb-warn">
        <TooltipProvider v-if="invalidHint" :delay-duration="120">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="nb-gap-hint" role="button" tabindex="0"><span aria-hidden="true" v-html="iconWarn" /></span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{{ invalidHint }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <TooltipProvider :delay-duration="220">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm"
              class="nb-run"
              :class="{ 'is-running': running, 'has-text': sendText !== '' }"
              type="button"
              :disabled="!canRun || submitted"
              :aria-disabled="!canRun || submitted"
              :aria-label="sendText ? (currentActionTitle || '执行') + ' · ' + sendText : (currentActionTitle || '执行')"
              @click.stop="emit('run')"
            >
              <span v-if="running" class="nb-spinner" aria-hidden="true" />
              <span v-else class="nb-send-icon" aria-hidden="true" v-html="iconSend" />
              <!--
                发送按钮里的文字（用户 2026-11-17）：provider 算出的花费，例如「0.65积分」。
                没有就不画，保持原按钮宽度 —— 老 provider 完全不受影响。
              -->
              <span v-if="!running && sendText" class="nb-send-text">{{ sendText }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" :arrow="true">{{ sendTip }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
</template>
