<script setup lang="ts">
/**
 * AppSettingsPanel —— @mini-canvas/ui 的成品设置**内容区**（左侧两级树 + 右侧全量配置）。
 *
 * 布局与交互（用户口径 2026-10-09）：
 *   · 左：**两级树**。一级 = 分组名的第一个 / 分段（扁平分组就是它自己）；展开后二级缩进显示
 *     （只有两层，没有第三层）。**折叠箭头只画在"真的能折叠"的一级行上**；二级是叶子、不可再折叠，
 *     不画箭头（用户口径：没有折叠块时不要显示折叠按钮）。
 *   · 右：**全部配置**不分页地叠成一个长列表（一级小标题 → 二级小标题 → 字段 / 插槽内容），整块滚动浏览。
 *     **字段直接铺在最外层、不套卡片**（用户口径：不要卡片包裹）。
 *   · 点左侧任一项 → 右侧平滑滚到对应位置；右侧滚动时左侧高亮跟着走（scroll-spy）。
 *
 * 数据与插槽：
 *   · 数据仍是宿主喂进来的 props.settings（内核 settings 单一数据源）；字段控件复用默认皮的
 *     SettingsSchemaField（color / number 精度滑块 / boolean 开关 / select），不自造第二套。
 *   · **内容插槽** settingsGroup/<完整分组 key> 仍被消费 —— 插件自绘页（Agent / 插件 / 热重载 /
 *     光标 / 插件展示）靠它接管正文；没有这一层，那些页就只剩一个占位项。
 *   · **左导航**：树的层级完全由 settings.groups() 的分组名推导。本面板**不渲染插件注册的
 *     settings.nav 自定义导航组件**（用户口径：这里不需要插件定制外观）；插件靠声明同名
 *     分组占位，一级项一个都不会丢。
 *   · **可排序**：每个一级分组包成 SlotAnchor，经 SlotComposer 与插件条目一起排序；
 *     插件可用 meta.group 把自己排在某个一级分组前后，且不会被重复渲染成第二个导航项。
 *
 * 窗口外壳不在这里：遮罩 / 居中 / 标题栏 / ✕ / Esc / 浮动窗 / 悬浮球由渲染层 <SettingsShell> 提供
 *（见 canvas-render/components/SettingsHost.vue），这里只画外壳里那一格。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER, useCanvasRender } from '@mini-canvas/canvas-render'
import { SlotAnchor, SlotComposer } from '@mini-canvas/canvas-render'
import SettingsSchemaField from '@mini-canvas/plugin-theme-default/components/settings/SettingsSchemaField.vue'

const props = defineProps<{ settings: SettingsPanelSource }>()

const { ctx } = useCanvasRender()

// 把标准字段渲染器下发给子树：settingsGroup/<key> 的内容插槽组件可 inject 后直接渲染某个字段控件。
provide(SETTINGS_FIELD_RENDERER, SettingsSchemaField as never)

const SEP = '/'
/** 一级名：分组名的第一个分段（扁平分组 = 它自己） */
const navOf = (key: string): string => key.split(SEP)[0]
/** 二级名（展示名）：带 / 的取后段，扁平分组取它自己 */
const leafLabelOf = (key: string): string => {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// ———— 插件装卸 → 重算树与内容（热装卸登记的新分组立刻可见）————
const occTick = ref(0)
function bumpOcc(): void {
  occTick.value += 1
}
/** 插槽调试开关：读 settings 的 slotDebug（主题 Config 声明），改了就刷新 */
const slotDebugTick = ref(0)
const settingsSlotDebug = computed(() => {
  void slotDebugTick.value
  try {
    return Boolean(ctx.get<{ get(k: string): unknown }>('settings')?.get('slotDebug'))
  } catch {
    return false
  }
})
const disposers: Array<{ dispose(): void }> = [
  ctx.on('ctx:plugin-installed', bumpOcc),
  ctx.on('ctx:plugin-uninstalled', bumpOcc),
]
const slotDebugOff = ctx.tryGet<{
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}>('settings')?.onChange(() => {
  slotDebugTick.value += 1
})
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
  cancelScrollAnimation()
  slotDebugOff?.dispose()
})

// ———— 树：一级 → 该一级下的完整分组 key 列表（保持 groups() 的原序）————
const groups = computed<string[]>(() => {
  void occTick.value
  return props.settings.groups()
})
const tree = computed<Map<string, string[]>>(() => {
  const m = new Map<string, string[]>()
  for (const g of groups.value) {
    const nav = navOf(g)
    if (!m.has(nav)) m.set(nav, [])
    m.get(nav)!.push(g)
  }
  return m
})
const navs = computed<string[]>(() => [...tree.value.keys()])
/**
 * 一级导航的可排序槽名：宿主把每个一级分组包成 SlotAnchor，
 * 插件可用 ctx.slots.register('settings.nav', { id: 'my-plugin/nav', before: 'host/nodes' }) 插到指定一级项前后。
 */
const SETTINGS_NAV_SLOT = 'settings.nav'

/**
 * 排序用的入口：插件条目只提供排序信息，**不渲染自己的组件**。
 *
 * 为什么返回 undefined：本面板的一级导航完全由分组名推导（用户口径 2026-10-09：
 * 这里不需要插件定制导航外观）。早先直接把 settings.nav 的组件渲染出来，
 * 结果是顶部多出「Agent / 插件 / 调试插件」三个点不动、又和下面自动分组重复的项。
 * 返回 undefined = SlotComposer 跳过渲染，但它的 before/after/order 仍参与排序。
 */
function settingsNavProps(): undefined {
  return undefined
}
function leavesOf(nav: string): string[] {
  return tree.value.get(nav) ?? []
}
/**
 * 一级下只有一个二级：**合并成一条平级项**（用户口径 2026-10-09：只有一个子节点的就不要拆成两级，
 * 一级菜单也就没必要做折叠）。左右都按"一个菜单"处理：左树一条、右侧一个小标题。
 */
function isSolo(nav: string): boolean {
  return leavesOf(nav).length === 1
}
/** 合并项对应的唯一二级 key（= 段锚点） */
function soloLeafOf(nav: string): string {
  return leavesOf(nav)[0] ?? ''
}

// ———— 折叠：一级收起/展开自己的二级 ————
const collapsed = ref<Set<string>>(new Set())
const isCollapsed = (nav: string): boolean => collapsed.value.has(nav)
function toggleNav(nav: string): void {
  const next = new Set(collapsed.value)
  if (next.has(nav)) next.delete(nav)
  else next.add(nav)
  collapsed.value = next
}
function expandNav(nav: string): void {
  if (!collapsed.value.has(nav)) return
  const next = new Set(collapsed.value)
  next.delete(nav)
  collapsed.value = next
}

// ———— 高亮态：当前"正在视口顶部"的段（完整分组 key）与它所属的一级 ————
const scrollEl = ref<HTMLElement | null>(null)
const treeEl = ref<HTMLElement | null>(null)
const currentKey = ref<string>('')
const currentNav = ref<string>('')

/** 选择器转义：分组名含 /、中文等字符时，用 CSS.escape；没有它就只去掉引号字符 */
function cssEscape(v: string): string {
  const es = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  return typeof es === 'function' ? es(v) : v.split('"').join('')
}
function navElOf(nav: string): HTMLElement | null {
  const cont = scrollEl.value
  return cont ? cont.querySelector<HTMLElement>('[data-nav="' + cssEscape(nav) + '"]') : null
}
function sectionElOf(key: string): HTMLElement | null {
  const cont = scrollEl.value
  return cont ? cont.querySelector<HTMLElement>('[data-sec="' + cssEscape(key) + '"]') : null
}

/**
 * 程序化滚动的时长（毫秒）。
 *
 * **为什么不用原生 `behavior: 'smooth'`**：那条路的时长由浏览器自己定，且大致随距离增长 ——
 * 点一个远一点的分类，动画能拖到一秒上下，用户实测「太慢」。这里自己补间，时长收成常量，
 * 近跳远跳同一个节奏。240ms = 设计 token 的动效上限（ui-style-guide §2.7）。
 */
const SCROLL_DURATION_MS = 240

let scrollRaf = 0

/** 掐掉上一段滚动补间（连点两个分类时，后一次点击立刻接管，不与前一次抢 scrollTop） */
function cancelScrollAnimation(): void {
  if (scrollRaf === 0) return
  cancelAnimationFrame(scrollRaf)
  scrollRaf = 0
}

/** 用户要求少动效时直接落位（与样式层的 prefers-reduced-motion 降级同一口径） */
function prefersReducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
  return typeof mm === 'function' ? mm('(prefers-reduced-motion: reduce)').matches : false
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

/** 从当前位置逐帧补间到 top（速度由 SCROLL_DURATION_MS 决定，与距离无关） */
function animateScrollTop(cont: HTMLElement, top: number): void {
  cancelScrollAnimation()
  const from = cont.scrollTop
  const delta = top - from
  if (!delta) return
  if (prefersReducedMotion()) {
    cont.scrollTop = top
    return
  }
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / SCROLL_DURATION_MS)
    cont.scrollTop = from + delta * easeOutCubic(t)
    scrollRaf = t < 1 ? requestAnimationFrame(step) : 0
  }
  scrollRaf = requestAnimationFrame(step)
}

function scrollToEl(el: HTMLElement): void {
  const cont = scrollEl.value
  if (!cont) return
  const top = el.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop
  const max = cont.scrollHeight - cont.clientHeight
  lockScrollUntilSettles(cont)
  animateScrollTop(cont, Math.max(0, Math.min(max, top)))
}

/**
 * 程序化滚动锁：滚动期间 scroll 事件会连续触发，若任由 scroll-spy 覆盖，
 * 高亮会在途经的段之间闪来闪去。锁未解前不重算高亮，保证落点即所选。
 * 解锁时机：容器 scrollend（动画真正结束），或兜底超时。
 */
let scrollLocked = false
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null
const SCROLL_LOCK_MAX_MS = SCROLL_DURATION_MS + 200

function releaseScrollLock(): void {
  scrollLocked = false
  if (scrollLockTimer !== null) {
    clearTimeout(scrollLockTimer)
    scrollLockTimer = null
  }
}
function lockScrollUntilSettles(el: HTMLElement): void {
  scrollLocked = true
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(releaseScrollLock, SCROLL_LOCK_MAX_MS)
  const onEnd = (): void => {
    el.removeEventListener('scrollend', onEnd)
    releaseScrollLock()
  }
  el.addEventListener('scrollend', onEnd)
}

/** 点一级：展开它、滚到该一级的标题锚点（没标题时退到它第一段） */
function selectNav(nav: string): void {
  expandNav(nav)
  currentNav.value = nav
  const leaves = leavesOf(nav)
  currentKey.value = leaves[0] ?? ''
  void nextTick(() => {
    const el = navElOf(nav) ?? (leaves[0] ? sectionElOf(leaves[0]) : null)
    if (el) scrollToEl(el)
  })
}

/** 点二级：展开所属一级、滚到该段 */
function selectLeaf(key: string): void {
  const nav = navOf(key)
  expandNav(nav)
  currentNav.value = nav
  currentKey.value = key
  void nextTick(() => {
    const el = sectionElOf(key)
    if (el) scrollToEl(el)
  })
}

/** scroll-spy：内容区滚动 → 取"最后一个贴到顶部"的段作为当前段 */
function onBodyScroll(): void {
  if (scrollLocked) return
  const cont = scrollEl.value
  if (!cont) return
  const ctop = cont.getBoundingClientRect().top
  let best = ''
  for (const nav of navs.value) {
    for (const leaf of leavesOf(nav)) {
      const el = sectionElOf(leaf)
      if (el && el.getBoundingClientRect().top <= ctop + 8) best = leaf
    }
  }
  if (!best) return
  currentKey.value = best
  currentNav.value = navOf(best)
}

/** 高亮段变化 → 左树里对应那行若被裁在可视区外，滚到"刚好露出"（block:nearest 不惊动外层） */
watch(currentKey, (key) => {
  if (!key) return
  void nextTick(() => {
    treeEl.value?.querySelector<HTMLElement>('[data-item="' + cssEscape(key) + '"]')?.scrollIntoView({ block: 'nearest' })
  })
})

// 分组变化（含插件热装卸）后，保证高亮仍指向存在的项（默认第一个一级的第一段）
watch(
  navs,
  (list) => {
    if (!list.length) {
      currentNav.value = ''
      currentKey.value = ''
      return
    }
    if (!list.includes(currentNav.value)) {
      currentNav.value = list[0]
      currentKey.value = leavesOf(list[0])[0] ?? ''
    }
  },
  { immediate: true },
)

// ———— 段正文：内容插槽 settingsGroup/<key> 优先，否则按 schema 平铺字段 ————
// 插槽可经 meta.mode 声明摆放：prepend / append / replace（缺省 = 接管整组）。
interface SlotOcc {
  id: string
  order: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: any
}
type ContentBlock = { kind: 'field'; key: string } | { kind: 'slot'; occ: SlotOcc }

function slotMode(oc: SlotOcc): 'replace' | 'prepend' | 'append' {
  const m = (oc.meta as { mode?: string } | undefined)?.mode
  return m === 'prepend' ? 'prepend' : m === 'append' ? 'append' : 'replace'
}

function blocksOf(groupKey: string): ContentBlock[] {
  void occTick.value
  const occs: SlotOcc[] = ctx.slots.occupants('settingsGroup/' + groupKey).map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
    meta: e.meta,
  }))
  const fields = props.settings.groupOf(groupKey)
  if (!occs.length) return fields.map((e) => ({ kind: 'field' as const, key: e.key }))
  const coexist = occs.some((o) => slotMode(o) !== 'replace')
  const sorted = (m: string): SlotOcc[] => occs.filter((o) => slotMode(o) === m).sort((a, b) => a.order - b.order)
  const blocks: ContentBlock[] = []
  blocks.push(...sorted('prepend').map((o) => ({ kind: 'slot' as const, occ: o })))
  if (coexist) blocks.push(...fields.map((e) => ({ kind: 'field' as const, key: e.key })))
  blocks.push(...sorted('replace').map((o) => ({ kind: 'slot' as const, occ: o })))
  blocks.push(...sorted('append').map((o) => ({ kind: 'slot' as const, occ: o })))
  return blocks
}
</script>

<template>
  <!-- 中间层根：左树 + 右侧内容都归本面板，外壳只给最外层窗口（框 / 标题栏 / ✕ / Esc）。
       本层直接作为 .psd-dialog 的弹性子项占满标题栏以下的高度。 -->
  <div class="flex min-h-0 w-full min-w-0 flex-1">
    <!-- 左：两级树（紧凑内边距） -->
    <aside class="flex min-h-0 w-[192px] flex-none flex-col border-r border-line bg-panel-soft p-1.5">
      <nav ref="treeEl" class="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="设置导航">
        <div v-if="!navs.length" class="py-6 text-center text-[12px] text-ink-dim">暂无设置分组</div>

        <!-- 可排序导航：宿主把每个一级分组包成一个 SlotAnchor；插件条目只参与排序、不渲染
             （本面板不展示插件自定义导航外观，避免重复项与点不动的死行）。 -->
        <SlotComposer :slot="SETTINGS_NAV_SLOT" class="flex flex-col" :item-props="settingsNavProps"
          :debug="Boolean(settingsSlotDebug)" label="设置导航">
        <template v-for="nav in navs" :key="nav">
          <SlotAnchor
            :id="'host/settings-' + nav"
            :order="100 + navs.indexOf(nav)"
          >
          <!-- 只有一个子节点：合并成一条平级项（不拆两级、不折叠、无箭头） -->
          <div v-if="isSolo(nav)" class="asp-row asp-row--solo"
            :class="{ 'is-current': currentKey === soloLeafOf(nav) }">
            <button class="asp-label" :data-item="soloLeafOf(nav)" @click="selectLeaf(soloLeafOf(nav))">{{ nav }}</button>
          </div>

          <!-- 有多个子节点：一级 + 可折叠的二级 -->
          <template v-else>
            <!-- 一级行：画折叠箭头。**它自己不参与高亮**（用户口径 2026-10-09：二级亮的时候一级不要亮）——
                 高亮只落在"当前那一段"，有子节点的分组里当前段永远是某个二级。 -->
            <div class="asp-row asp-row--l1">
              <button
                class="asp-caret"
                :aria-expanded="!isCollapsed(nav)"
                :aria-label="(isCollapsed(nav) ? '展开' : '收起') + nav"
                :title="(isCollapsed(nav) ? '展开' : '收起') + nav"
                @click="toggleNav(nav)"
              >
                <svg class="asp-chevron" :class="{ 'is-open': !isCollapsed(nav) }" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <button class="asp-label" :data-item="nav" @click="selectNav(nav)">{{ nav }}</button>
            </div>

            <!-- 二级行（缩进、无折叠箭头：叶子不可再折叠） -->
            <div v-show="!isCollapsed(nav)" class="flex flex-col">
              <div v-for="leaf in leavesOf(nav)" :key="leaf" class="asp-row asp-row--l2"
                :class="{ 'is-current': currentKey === leaf }">
                <button class="asp-label asp-label--l2" :data-item="leaf" @click="selectLeaf(leaf)">{{ leafLabelOf(leaf) }}</button>
              </div>
            </div>
          </template>
          </SlotAnchor>
        </template>
        </SlotComposer>
      </nav>
    </aside>

    <!-- 右：全部配置叠成一个长列表（字段不套卡片，直接铺在最外层），点左树滚过来 -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="flex h-11 flex-none items-center gap-3 border-b border-line px-5">
        <h3 class="truncate text-[13px] font-semibold">{{ currentNav || '设置' }}</h3>
        <p class="truncate text-[11px] text-ink-dim">共 {{ navs.length }} 个分类 · {{ groups.length }} 个分组</p>
      </header>

      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto bg-canvas-bg px-5 pb-10 pt-1" @scroll="onBodyScroll">
        <div v-if="!groups.length" class="grid h-full place-items-center text-xs text-ink-dim">暂无设置项</div>

        <template v-for="nav in navs" :key="nav">
          <!-- 只有一个子节点：合并成一段（小标题 = 一级名，锚点 = 那个二级 key） -->
          <template v-if="isSolo(nav)">
            <section :data-sec="soloLeafOf(nav)" class="asp-section">
              <h4 class="asp-section-title" :data-nav="nav">{{ nav }}</h4>
              <div class="asp-section-body">
                <template v-for="b in blocksOf(soloLeafOf(nav))" :key="b.kind === 'field' ? 'f-' + b.key : 's-' + b.occ.id">
                  <SettingsSchemaField v-if="b.kind === 'field'" :group="soloLeafOf(nav)" :field-key="b.key"
                    :settings="props.settings" />
                  <component v-else :is="b.occ.component" :group="soloLeafOf(nav)" :settings="props.settings" />
                </template>
                <p v-if="!blocksOf(soloLeafOf(nav)).length" class="asp-empty">这个分组还没有可配置项</p>
              </div>
            </section>
          </template>

          <!-- 多个子节点：一级小标题 + 各二级段 -->
          <template v-else>
            <!-- 一级小标题：既是视觉分界，也是"点一级"的滚动锚点 -->
            <h3 class="asp-group-title" :data-nav="nav">{{ nav }}</h3>

            <section v-for="leaf in leavesOf(nav)" :key="leaf" :data-sec="leaf" class="asp-section">
              <!-- 二级小标题：细线条分隔，无卡片包裹 -->
              <h4 class="asp-section-title">{{ leafLabelOf(leaf) }}</h4>
              <div class="asp-section-body">
                <template v-for="b in blocksOf(leaf)" :key="b.kind === 'field' ? 'f-' + b.key : 's-' + b.occ.id">
                  <SettingsSchemaField v-if="b.kind === 'field'" :group="leaf" :field-key="b.key"
                    :settings="props.settings" />
                  <component v-else :is="b.occ.component" :group="leaf" :settings="props.settings" />
                </template>
                <p v-if="!blocksOf(leaf).length" class="asp-empty">这个分组还没有可配置项</p>
              </div>
            </section>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 窗口级样式（遮罩 / 居中 / 标题栏 / 浮动）在外壳 SettingsShell 里，这里只剩内容区自己的东西。
   配色全部走主题 token（--ui-*），不写死 hex。 */

/* ===== 左树行（紧凑：一级 30px / 二级 26px）===== */
.asp-row {
  display: flex;
  align-items: center;
  border-radius: 8px;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.asp-row--l1 { min-height: 30px; }
.asp-row--l2 { min-height: 26px; }

/* 合并项（一级下只有一个二级）：与一级同样高，文字与一级文字对齐（24px），无箭头 */
.asp-row--solo { min-height: 30px; }
.asp-row--solo .asp-label { padding-left: 24px; }

.asp-row:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }

/* 当前项（定位锚点选中态）：一层**主题色浅底** + 主题色文字，与 hover 的中性灰明确区分。
   为什么不用中性灰：暗色面板上灰 10% 几乎看不见，跟 hover 的灰又几乎一样 —— 用户实测报过
   「只有 hover 有背景、没有选择效果」（2026-10-09）。这也正是默认皮 .psd-nav-item.active 的做法。
   一级 / 二级 / 合并项共用同一条规则；**不要边框**（border/outline 皆 0）。
   is-current 规则写在 :hover 之后 → 同特异性下选中态赢，鼠标停在选中项上不会把它压回灰。 */
.asp-row.is-current { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.asp-row.is-current .asp-label { color: var(--ui-accent-hover, #0e7490); }

.asp-caret {
  flex: 0 0 auto;
  /* 点击区域放大到 24×24（用户口径：按钮区域太小） */
  width: 24px;
  height: 24px;
}

.asp-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-ink-mute, #9ca3af);
  cursor: pointer;
  transition: color 0.15s ease;
}

/* 不给背景：hover 只把箭头颜色变深（用户口径） */
.asp-caret:hover {
  color: var(--ui-ink, #111827);
}

.asp-chevron {
  width: 14px;
  height: 14px;
  transition: transform 0.18s ease;
}

/* 展开态 = 箭头转正向下；收起态保持指向右 */
.asp-chevron.is-open { transform: rotate(90deg); }

.asp-label {
  flex: 1;
  min-width: 0;
  display: block;
  /* 一级文字起点 = 箭头 24px（这里不再额外留左边距） */
  padding: 0 8px 0 0;
  border: 0;
  background: transparent;
  color: var(--ui-ink, #374151);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

/* 二级（叶子）：**相对一级文字再缩进**（一级 24px → 二级 44px，差 20px 一眼看出层级）+ 小一号字 */
.asp-label--l2 {
  padding-left: 44px;
  font-size: 12px;
  color: var(--ui-ink-dim, #6b7280);
}

.asp-label:focus-visible,
.asp-caret:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: -2px;
  border-radius: 6px;
}

/* ===== 右侧内容（无卡片：小标题 + 字段直接铺开）===== */
.asp-group-title {
  margin: 12px 0 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ui-ink-mute, #9ca3af);
}

.asp-group-title:first-child { margin-top: 4px; }

.asp-section { padding: 0; }

.asp-section-title {
  margin: 6px 0 0;
  padding: 8px 0 8px;
  border-bottom: 1px solid var(--ui-line-soft, rgb(0 0 0 / 0.05));
  font-size: 13px;
  font-weight: 700;
  color: var(--ui-ink, #111827);
}

.asp-section-body { padding-bottom: 4px; }

.asp-empty {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  color: var(--ui-ink-mute, #9ca3af);
}

@media (prefers-reduced-motion: reduce) {
  .asp-row,
  .asp-caret,
  .asp-chevron {
    transition: none !important;
  }
}
</style>
