<script setup lang="ts">
/**
 * ChoicePicker —— 「卡片 / 分栏」两视图的通用选择面板（ModelPicker 的通用版）。
 *
 * 用户口径（2026-11-07）：
 * 「我 Agent 那个插件里面的模型下拉是有两种的：第一个是卡片形式，第二个是分栏形式。
 *   这边其实你的文本、图片和视频，下拉都可以使用这种方式。」
 *
 * 所以卡片/分栏这套交互从模型上剥离出来：
 * - 模型：调用方传模型清单（ModelPicker 就是它对 `ModelPicker` 的封装）；
 * - 图片 / 视频：调用方传生成动作清单（每个动作一条），同样能卡片、能分栏、能按平台聚合。
 *
 * 面板只负责「列出 → 选一个」，选中之后干什么由调用方决定（emit('pick')）。
 *
 * 注意：SVG 的渐变靠 url(#id) 引用，同一张图重复出现时 id 撞车会让后出现的变空白，
 * 所以这里统一用 brandSvg() 取图（它每次都给独立 id）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Check, ChevronRight, Layers, Search, X } from 'lucide-vue-next'
import { brandName, brandSvg, detectPlatform } from '../render/modelBrandIcons.js'
import { scrollTopForVisibleItem } from '../shared/selectionScroll.js'
import AgentScrollArea from './AgentScrollArea.vue'

/** 面板里的一行：模型或生成动作都归一成这个形状 */
export interface ChoiceItem {
  /** 唯一 id（选中回传给调用方） */
  id: string
  /** 主标题（卡片第一行） */
  title: string
  /** 副标题（平台名 / 说明） */
  subtitle?: string
  /** 右侧备注（上下文长度 / 参数摘要） */
  note?: string
  /** 平台 key；不传就按 title 猜 */
  platform?: string
  /** 是否默认项（右上角挂 Badge） */
  isDefault?: boolean
  /** 是否可用（无密钥的模型 / 当前节点不支持的动作） */
  disabled?: boolean
  /**
   * 这一行自己的图标（完整 `<svg>` 或 `<img>` 字符串），由调用方给。
   *
   * 为什么需要：面板原来只有「按 platform 查品牌图标」一条路，于是 provider 自带的
   * 图标只在触发器上出现、列表里被换成兜底图形（用户 2026-11-08 截图）。
   * 给了 svg 就原样渲染，platform 继续只负责分组与名字。
   */
  svg?: string
  /**
   * 这一行所属平台的账号（多于一个才在行尾出「账号」二级菜单）。
   *
   * 用户口径 2026-11-10：一个平台可能有多个号；下拉里**不新增模型行**，
   * 而是在这一行右侧挂一个箭头，hover / 点开二级菜单选账号。
   */
  accounts?: Array<{ id: string; name?: string }>
  /** 这一行当前选中的账号 id（空 = 用平台默认号） */
  accountId?: string
  /** 平台默认账号 id（没显式选号时，菜单里在它旁边打勾） */
  defaultAccount?: string
}

const props = withDefaults(
  defineProps<{
    items: ChoiceItem[]
    /** 当前选中项的 id */
    currentId?: string
    /** 面板标题（模型 / 生成） */
    title?: string
    /** 搜索占位文案 */
    placeholder?: string
    /** 分栏左列标题（平台 / 分类） */
    railLabel?: string
    /** 是否显示「全部」那一行 */
    showAll?: boolean
    /** 空态说明 */
    emptyText?: string
  }>(),
  {
    currentId: '',
    title: '选择',
    placeholder: '搜索…',
    railLabel: '平台',
    showAll: true,
    emptyText: '没有匹配项',
  },
)

const emit = defineEmits<{
  pick: [item: ChoiceItem]
  /** 选了某个账号（`item.id` 是行 id，账号归属这一行所属的平台） */
  pickAccount: [itemId: string, accountId: string]
  /** 视图切换（底栏据此在分栏时把浮层加宽加高） */
  'update:view': [view: 'card' | 'split']
}>()

const Button = useUiComponent('Button')
const Badge = useUiComponent('Badge')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')

const query = ref('')
const view = ref<'card' | 'split'>('card')
const platform = ref('all')

/** 只认 card / split；其它值（键盘切换偶尔传来奇数）保持原样，避免页签与界面错位 */
function setView(value: string | number): void {
  if (value === 'split' && view.value !== 'split') view.value = 'split'
  else if (value === 'card' && view.value !== 'card') view.value = 'card'
  emit('update:view', view.value)
}

function platformOf(item: ChoiceItem): string {
  return item.platform || detectPlatform(item.title, '')
}

const platforms = computed(() => {
  const rows: Array<{ key: string; label: string; count: number }> = []
  for (const item of props.items) {
    const key = platformOf(item)
    const hit = rows.find((g) => g.key === key)
    if (hit) hit.count++
    else rows.push({ key, label: brandName(key), count: 1 })
  }
  return props.showAll
    ? [{ key: 'all', label: '全部平台', count: props.items.length }, ...rows]
    : rows
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.items.filter((item) => {
    if (platform.value !== 'all' && platformOf(item) !== platform.value) return false
    if (!q) return true
    const brand = brandName(platformOf(item))
    return (item.title + ' ' + (item.subtitle ?? '') + ' ' + (item.note ?? '') + ' ' + brand).toLowerCase().includes(q)
  })
})

/** 每个视图一个滚动容器，各自的 ref */
const scrollRef = ref<HTMLElement | null>(null)

function scrollRootOf(value: unknown): HTMLElement | null {
  if (!value) return null
  if (value instanceof HTMLElement) return value
  const exposed = value as { rootElement?: () => HTMLElement | null }
  return typeof exposed.rootElement === 'function' ? exposed.rootElement() : null
}

/**
 * 把选中项滚进可视区。
 *
 * 用真实矩形换算（不用 offsetTop）：列表项与外层滚动区之间隔了好几层 offsetParent。
 * 选中态认 aria-selected="true" —— 那是唯一真相。
 */
function scrollSelectedIntoView(): void {
  const root = scrollRootOf(scrollRef.value)
  const sel = (root ?? document).querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  const scrollViewport = (el: Element | null | undefined): HTMLElement | null =>
    el?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? (el as HTMLElement | null) ?? null
  const box = scrollViewport(sel?.closest<HTMLElement>('.ac-split-scroll, .ac-menu-scroll') ?? scrollViewport(root))
  if (!box || box.clientHeight <= 0) return
  const item = sel && box.contains(sel) ? sel : box.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  if (!item) return
  const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  box.scrollTop = scrollTopForVisibleItem(
    { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight },
    { top, height: item.offsetHeight },
    4,
  )
  const selRect = item.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  if (selRect.bottom > boxRect.bottom) box.scrollTop += selRect.bottom - boxRect.bottom
  else if (selRect.top < boxRect.top) box.scrollTop -= boxRect.top - selRect.top
}

let settleTimer: number | null = null
let observer: ResizeObserver | null = null
let resizeTimer: number | null = null

/** 滚两次：立刻一次 + 入场动画结束后校正一次 */
function scheduleScroll(): void {
  scrollSelectedIntoView()
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    scrollSelectedIntoView()
  }, 200)
}

/** 尺寸一变就重定位（先攒 80ms，避免自己滚动触发自己） */
function observeBox(): void {
  observer?.disconnect()
  observer = null
  const root = scrollRootOf(scrollRef.value)
  const box =
    root?.querySelector<HTMLElement>('.ac-split-scroll [data-slot="scroll-area-viewport"]') ??
    root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
    null
  if (!box || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null
      scrollSelectedIntoView()
    }, 80)
  })
  observer.observe(box)
}

function refreshLayout(): void {
  void nextTick(() => {
    scheduleScroll()
    observeBox()
  })
}

watch(() => [props.currentId, props.items.length], () => refreshLayout())
watch(view, () => refreshLayout())
watch(platform, () => refreshLayout())

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  if (settleTimer !== null) window.clearTimeout(settleTimer)
})

function pick(item: ChoiceItem): void {
  if (item.disabled) return
  emit('pick', item)
}

/** 这一行是否要出「账号」二级菜单：只有多于一个号才有得选 */
function hasAccounts(item: ChoiceItem): boolean {
  return (item.accounts?.length ?? 0) > 1
}

/** 这一行实际生效的账号：显式选过的优先，否则用平台默认号 */
function effectiveAccountOf(item: ChoiceItem): string {
  return item.accountId || item.defaultAccount || ''
}

/** 当前账号名；没选也没默认号就空着（触发器上不写多余的字） */
function accountLabelOf(item: ChoiceItem): string {
  const id = effectiveAccountOf(item)
  if (!id) return ''
  return (item.accounts ?? []).find((a) => a.id === id)?.name || id
}

/** 选了账号：只记账号，不改选中的模型；选完把菜单收起来 */
function pickAccount(item: ChoiceItem, accountId: string): void {
  emit('pickAccount', item.id, accountId)
  clearAccountTimer()
  accountOpenId.value = ''
}

/** 账号那一小段字：没选就写「默认」 */
function accountShortOf(item: ChoiceItem): string {
  return accountLabelOf(item) || '默认'
}

/*
 * 整行悬停展开账号菜单（用户 2026-11-10）：
 * 「整个 item 都可以进行 hover 来显示二级菜单，而不是只有这个图标才能 hover」。
 *
 * 这里**不借用任何菜单组件**的开关机制，只有一份自己的状态：
 * - reka 的 DropdownMenuSub 只认那个小触发器，指针一离开就关（实测来不及移过去）；
 * - 项目的 Popover 参与「浮层互斥」，它一打开就把父级「生成模型」菜单关掉。
 *
 * 所以账号菜单是一个自己画的小浮层（Teleport 到 body + 相对箭头定位）：
 * - 打开：整行 mouseenter，延迟 120ms（扫过列表时不会一路弹）；
 * - 关闭：行 / 菜单各自离开时给 500ms 宽限，指针进到菜单上就取消；
 * - 选了账号、面板收起、组件卸载都会立刻关。
 */
/** 关菜单的宽限：要够指针穿过行与菜单之间那几像素空隙 */
const ACCOUNT_CLOSE_GRACE = 500
const accountOpenId = ref('')
/** 菜单定位：以被悬停那一行的箭头为锚点 */
const accountAnchor = ref<HTMLElement | null>(null)
const accountMenuPos = ref<{ left: number; top: number }>({ left: 0, top: 0 })
let accountTimer: number | null = null

function clearAccountTimer(): void {
  if (accountTimer !== null) {
    window.clearTimeout(accountTimer)
    accountTimer = null
  }
}

function openAccountSoon(item: ChoiceItem): void {
  if (!hasAccounts(item)) return
  clearAccountTimer()
  accountTimer = window.setTimeout(() => {
    openAccount(item)
    accountTimer = null
  }, 120)
}

/** 立刻打开某一行的账号菜单（点箭头走这条，不经延迟） */
function openAccount(item: ChoiceItem, anchor?: HTMLElement | null): void {
  if (!hasAccounts(item)) return
  clearAccountTimer()
  const el = anchor ?? accountAnchorOf(item)
  accountAnchor.value = el
  if (el) {
    const r = el.getBoundingClientRect()
    // 菜单贴箭头右侧展开；右侧放不下就翻到左边（口径同任何下拉）
    const menuW = 168
    const left = r.right + 6 + menuW > window.innerWidth - 8 ? r.left - menuW - 6 : r.right + 6
    const top = Math.min(Math.max(8, r.top - 6), window.innerHeight - 8 - 120)
    accountMenuPos.value = { left, top }
  }
  accountOpenId.value = item.id
}

/** 找某一行的箭头元素（模板里标了 data-account-anchor） */
function accountAnchorOf(item: ChoiceItem): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[data-account-anchor]')
  for (const el of all) {
    if (el.dataset.accountAnchor === item.id) return el
  }
  return null
}

function closeAccountSoon(item: ChoiceItem): void {
  if (!hasAccounts(item)) return
  clearAccountTimer()
  accountTimer = window.setTimeout(() => {
    if (accountOpenId.value === item.id) accountOpenId.value = ''
    accountTimer = null
  }, ACCOUNT_CLOSE_GRACE)
}

/** 指针进了账号菜单：留住它 */
function keepAccountMenu(): void {
  clearAccountTimer()
}

/** 面板/组件收起时一并收掉账号菜单 */
function closeAccountNow(): void {
  clearAccountTimer()
  accountOpenId.value = ''
}

/**
 * 账号浮层是 Teleport 到 body 的，对「生成模型」那个 DropdownMenu 来说属于**外部**。
 *
 * reka 的「点外面关闭」在 document 的**捕获**阶段监听 pointerdown —— 冒泡阶段的
 * .stop 拦不住它，所以点一下账号，整块模型面板就跟着关了（2026-11-10 实测）。
 * 这里在 window 的捕获阶段（比 document 更早）看一眼：点在账号浮层里就截断这次事件，
 * 外层收不到，自然不关；点在别处则把账号浮层收起。
 */
function onAccountPointerDown(e: PointerEvent): void {
  if (!accountOpenId.value) return
  const target = e.target as Element | null
  if (!target || typeof target.closest !== 'function') return
  if (target.closest('.ac-account-pop')) {
    e.stopPropagation()
    return
  }
  if (!target.closest('.ac-model-account-trigger')) closeAccountNow()
}

/** 当前开着账号菜单的那一行 */
const openRow = computed(() => props.items.find((i) => i.id === accountOpenId.value))
const accountsOfOpenRow = computed(() => openRow.value?.accounts ?? [])
const effectiveAccountOfOpenRow = computed(() => (openRow.value ? effectiveAccountOf(openRow.value) : ''))

function pickAccountOfOpenRow(accountId: string): void {
  const row = openRow.value
  if (row) pickAccount(row, accountId)
}

onMounted(() => {
  window.addEventListener('pointerdown', onAccountPointerDown, true)
})
onBeforeUnmount(() => {
  clearAccountTimer()
  window.removeEventListener('pointerdown', onAccountPointerDown, true)
})

defineExpose({ refreshLayout })
</script>

<template>
  <div class="ac-panel cp-panel" :class="{ 'is-split': view === 'split' }" role="listbox" :aria-label="title">
    <div class="ac-panel-head">
      <div class="ac-panel-head-top">
        <div class="ac-panel-heading">
          <span class="ac-panel-title">{{ title }}</span>
          <span class="ac-panel-count">{{ items.length }}</span>
        </div>
        <!-- 卡片 / 分栏：Agent 模型下拉的同一套交互，图片 / 视频也用它 -->
        <!--
          与 ModelPicker 同一条规矩：页签只走 update:model-value 一条通道，
          不再手写 @click（同一次点击 setView 被调两次 → 页签与界面错位）。
          data-state / aria-selected 交给 reka。
        -->
        <!--
          卡片 / 分栏页签：**自定义按钮**，不再用 shadcn Tabs。
          用户 2026-11-07：reka Tabs 的选中态是组件内部状态，切换时高亮与内容
          长期不同步（连续反馈 5+ 次）。自定义版的高亮直接绑在本组件的 view 上，
          类一变立刻重渲染，不存在第二份状态。
        -->
        <div class="ac-view-tabs" role="tablist" aria-label="面板布局">
          <button
            type="button"
            class="ac-view-tab"
            :class="{ 'is-active': view === 'card' }"
            :aria-selected="view === 'card'"
            role="tab"
            @click="setView('card')"
          >卡片</button>
          <button
            type="button"
            class="ac-view-tab"
            :class="{ 'is-active': view === 'split' }"
            :aria-selected="view === 'split'"
            role="tab"
            @click="setView('split')"
          >分栏</button>
        </div>
      </div>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Search :size="14" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput v-model="query" type="search" name="cp-search" :placeholder="placeholder"
          :aria-label="placeholder" autocomplete="off" spellcheck="false" />
        <InputGroupAddon v-if="query" align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="query = ''">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div v-if="!items.length" class="ac-menu-empty">{{ emptyText }}</div>

    <div v-else ref="scrollRef" class="ac-menu-scroll ac-panel-body">
      <div class="ac-view-stack">
        <AgentScrollArea class="ac-panel-scroll ac-view-pane" :class="{ 'is-active': view === 'card' }"
          body-class="ac-panel-scroll-body ac-model-scroll-body">
          <div v-if="filtered.length" class="ac-model-grid">
            <div v-for="item in filtered" :key="item.id" class="ac-model-entry"
              role="option" :aria-selected="item.id === currentId" :aria-disabled="item.disabled || undefined"
              @mouseenter="openAccountSoon(item)" @mouseleave="closeAccountSoon(item)">
              <Button variant="ghost" size="sm" class="ac-model-hit"
                :disabled="item.disabled" @click="pick(item)">
                <span class="ac-model-brand" :title="brandName(platformOf(item))" aria-hidden="true"
                  v-html="item.svg || brandSvg(platformOf(item))"></span>
                <span class="ac-model-copy">
                  <span class="ac-model-card-top">
                    <span class="ac-model-id">{{ item.title }}</span>
                    <Badge v-if="item.isDefault" variant="secondary">默认</Badge>
                  </span>
                  <span class="ac-model-meta">
                    <span>{{ item.subtitle || brandName(platformOf(item)) }}</span>
                    <template v-if="item.note">
                      <span class="ac-dot-sep" aria-hidden="true"></span>
                      <span>{{ item.note }}</span>
                    </template>
                  </span>
                </span>
              </Button>
              <!-- 多账号：整行 hover / 点箭头 → 账号菜单（不新增模型行） -->
              <button v-if="hasAccounts(item)" type="button" class="ac-model-account-trigger"
                :data-account-anchor="item.id"
                :aria-expanded="accountOpenId === item.id"
                :title="'选择账号（当前：' + accountShortOf(item) + '）'"
                :aria-label="'选择账号（当前：' + accountShortOf(item) + '）'"
                @click.stop="openAccount(item, $event.currentTarget as HTMLElement)">
                <ChevronRight :size="14" aria-hidden="true" />
              </button>
              <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
            </div>
          </div>
          <div v-else class="ac-empty-state">
            <span class="ac-empty-icon"><Search :size="18" /></span>
            <span class="ac-empty-title">{{ emptyText }}</span>
            <span class="ac-empty-desc">换个关键词或平台试试。</span>
          </div>
        </AgentScrollArea>

        <div class="ac-view-pane ac-split" :class="{ 'is-active': view === 'split' }">
          <aside class="ac-split-rail" :aria-label="railLabel">
            <div class="ac-rail-label">{{ railLabel }}</div>
            <AgentScrollArea class="ac-rail-scroll" body-class="ac-rail-scroll-body">
              <Button v-for="g in platforms" :key="g.key" variant="ghost" size="sm"
                :aria-pressed="platform === g.key" @click="platform = g.key">
                <span v-if="g.key === 'all'" class="ac-rail-icon" aria-hidden="true"><Layers :size="14" /></span>
                <span v-else class="ac-rail-brand" :title="g.label" aria-hidden="true" v-html="brandSvg(g.key)"></span>
                <span class="ac-rail-name">{{ g.label }}</span>
                <span class="ac-rail-count">{{ g.count }}</span>
              </Button>
            </AgentScrollArea>
          </aside>
          <div class="ac-split-main">
            <AgentScrollArea class="ac-split-scroll" body-class="ac-split-scroll-body">
              <div v-if="filtered.length" class="ac-model-row-list">
                <div v-for="item in filtered" :key="item.id" class="ac-model-entry ac-model-entry-row"
                  role="option" :aria-selected="item.id === currentId" :aria-disabled="item.disabled || undefined"
                  @mouseenter="openAccountSoon(item)" @mouseleave="closeAccountSoon(item)">
                  <Button variant="ghost" size="sm" class="ac-model-hit"
                    :disabled="item.disabled" @click="pick(item)">
                    <span class="ac-model-brand" :title="brandName(platformOf(item))" aria-hidden="true"
                    v-html="item.svg || brandSvg(platformOf(item))"></span>
                    <span class="ac-model-copy">
                      <span class="ac-model-id">{{ item.title }}</span>
                      <span class="ac-model-meta">
                        <span>{{ item.subtitle || brandName(platformOf(item)) }}</span>
                        <template v-if="item.note">
                          <span class="ac-dot-sep" aria-hidden="true"></span>
                          <span>{{ item.note }}</span>
                        </template>
                      </span>
                    </span>
                    <span class="ac-model-badges">
                      <Badge v-if="item.isDefault" variant="secondary">默认</Badge>
                    </span>
                  </Button>
                  <button v-if="hasAccounts(item)" type="button" class="ac-model-account-trigger"
                    :data-account-anchor="item.id"
                    :aria-expanded="accountOpenId === item.id"
                    :title="'选择账号（当前：' + accountShortOf(item) + '）'"
                    :aria-label="'选择账号（当前：' + accountShortOf(item) + '）'"
                    @click.stop="openAccount(item, $event.currentTarget as HTMLElement)">
                    <ChevronRight :size="14" aria-hidden="true" />
                  </button>
                  <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                </div>
              </div>
              <div v-else class="ac-empty-state">
                <span class="ac-empty-icon"><Search :size="18" /></span>
                <span class="ac-empty-title">{{ emptyText }}</span>
                <span class="ac-empty-desc">换个关键词或平台试试。</span>
              </div>
            </AgentScrollArea>
          </div>
        </div>
      </div>
    </div>

    <!--
      账号菜单：自己画的浮层（Teleport 到 body）。
      不用菜单组件的原因见脚本里 openAccountSoon 上方的注释：一个会被 reka 抢先关掉，
      另一个参与浮层互斥、会把「生成模型」整体关掉。
    -->
    <Teleport to="body">
      <div v-if="accountOpenId" class="ac-account-pop" role="menu" aria-label="选择账号"
        :style="{ left: accountMenuPos.left + 'px', top: accountMenuPos.top + 'px' }"
        @mouseenter="keepAccountMenu" @mouseleave="closeAccountNow">
        <p class="ac-account-pop-head">选择账号</p>
        <button v-for="a in accountsOfOpenRow" :key="a.id" type="button" role="menuitem"
          class="ac-account-pop-item"
          :data-active="a.id === effectiveAccountOfOpenRow ? 'true' : undefined"
          @pointerdown.stop.prevent
          @mousedown.prevent
          @click="pickAccountOfOpenRow(a.id)">
          <span class="ac-account-pop-name">{{ a.name || a.id }}</span>
          <Check v-if="a.id === effectiveAccountOfOpenRow" :size="14" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="./agent-composer/part2.css"></style>
<style scoped src="./agent-composer/part3.css"></style>
<style scoped src="./agent-composer/part4.css"></style>

