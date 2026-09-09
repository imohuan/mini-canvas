<script setup lang="ts">
/**
 * PluginSettingsDialog —— theme-default 的默认设置面板皮（Dialog + 左右导航 + 可选二级页签版）。
 *
 * 定位：可替换设置面板 settingsPanel 槽的默认赢家，被 <SettingsHost/> 渲染（喂 props.settings）。
 * 从"一列堆叠分组卡片"重构为**居中 modal 弹窗 + 左右布局的标准设置界面**，并支持"分组名带 / 的二级菜单"：
 *   - 左 = 一级分组导航（一项 = group key 的第一个 `/` 分段；无 `/` 的扁平分组即它自己）
 *   - 右 = 二级页签条 + 内容：某一级下若**多于一个**二级分组则显示页签(tab)切换；只有一个则直接展示内容、不显示 tab
 * 依赖方向：plugin-theme-default → canvas-render(useCanvasRender 拿 ctx) → canvas-core-v2，不反向。
 *
 * ## 分组 key 的语义（新增二级菜单）
 * 每个配置字段声明在某个 `group`（plugin Config schema 里字段的 group / 内核 settings 里申明的组名）。
 * 这里把 group key 按 `/` 切成两级来组织 UI：
 *   - key 无 `/`（如 `图片`、`连线`）→ 一级名 = key 本身，下面只有它自己一个"叶子" → 左导航显示它，右侧直接展示其内容（无页签）。
 *   - key 带 `/`（如 `常规/显示`）→ 一级名 = `常规`，二级名 = `显示` → 左导航按一级名合并显示 `常规`；
 *     同属 `常规` 的二级分组多于一个时，右侧出现 `显示`/… 的页签条，正文跟随当前页签；只有一个则无页签直接展示。
 *
 * ## 三套可扩展插槽（内核 ctx.slots 多 occupant 机制，插件 ctx.slots.register 填充，装卸自动回收）
 *   1) 左导航插槽  `settingsNav`    — 定制一级导航项（id = 一级名，命中顶替；否则末尾追加自定义一级项）。
 *   2) 二级页签插槽 `settingsTab`   — 定制二级页签（id 首段 = 当前一级名，见下），与 settingsNav 语义对称。
 *   3) 右内容插槽  `settingsGroup/<key>` — 接管某个**完整分组 key** 的右侧内容区渲染（key 为带/的叶子全名或扁平分组名）。
 *
 *   `settingsNav`/`settingsTab` occupant 都通过 props 收到 { group, active, onSelect }；onSelect(key) 切过去，不给则点了没反应。
 *   - `settingsNav`：id 命中某一级名 → 顶替该一级导航项；不命中 → 作为"纯自定义一级项"末尾追加（右侧需配 settingsGroup/<id> 接管）。
 *   - `settingsTab`：id 首段 === 当前一级名 才对本级生效——
 *     · id 命中该一级下某个完整分组 key → 顶替那个二级页签（正文仍由该 key 的内容插槽/schema 决定）；
 *     · 不命中 → 追加一个自定义二级页签（需另注册 settingsGroup/<id> 接管其内容）。
 *
 * 打开/关闭：宿主(App.vue)用 v-if="settingsOpen" 控制本面板是否渲染；本面板内部 ✕ / 点遮罩 / Esc
 * 经 ctx.emit('settings:ui-close') 通知宿主关闭（宿主 onReady 里 ctx.on 订阅置 settingsOpen=false）。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER, useCanvasRender } from '@mini-canvas/canvas-render'
import SettingsSchemaField from './SettingsSchemaField.vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlotOcc = { id: string; order: number; component: any; meta?: any }

const props = defineProps<{
  settings: SettingsPanelSource
  /** 是否允许点遮罩关闭（默认 true）；Esc 关闭亦随此开关。 */
  closeOnMask?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { ctx } = useCanvasRender()

// —— 下发"标准 schema 字段渲染器"给本面板内的内容插槽组件（settingsGroup/<key> occupant）——
// 插件自定义组件（预览UI等）经 injectSettingsFieldRenderer() 拿到后，可 <component :is> 直接渲染某字段控件
provide(SETTINGS_FIELD_RENDERER, SettingsSchemaField)

const SEP = '/'

/** 一级名：group key 的第一个分段。扁平分组(=自己) 与 二级分组(=前段) 在此汇合。 */
function navOf(key: string): string {
  return key.split(SEP)[0]
}
/** 二级名 / 展示名：带 `/` 的取 `/` 后段，扁平分组取它自己。 */
function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// —— 左导航插槽 occupants（插件塞的导航项），插件装卸/变更时重读 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const navList = ref<SlotOcc[]>([])
function reloadNav(): void {
  navList.value = ctx.slots.occupants('settingsNav').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
  }))
}
reloadNav()

// —— 二级页签插槽 occupants（settingsTab）：全局读一次，渲染时按"当前一级名"过滤归并 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabList = ref<SlotOcc[]>([])
function reloadTabs(): void {
  tabList.value = ctx.slots.occupants('settingsTab').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
  }))
}
reloadTabs()

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reloadNav),
  ctx.on('ctx:plugin-uninstalled', reloadNav),
  ctx.on('ctx:plugin-installed', reloadTabs),
  ctx.on('ctx:plugin-uninstalled', reloadTabs),
)
// P2-1：内核 schema 变更订阅 → 强制刷新分组列表（插件热装卸后新 config 分组立即可见）
const rawSettings = ctx.get<{ onSchemaChange(cb: () => void): { dispose(): void } }>('settings')
const schemaOff = rawSettings?.onSchemaChange(() => { refreshTick.value += 1 })
if (schemaOff) disposers.push(schemaOff)
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

// —— 分组（schema）—— 
// P2-1：schema 变化（插件热装卸 define/移除项）经 settings.onSchemaChange 置 refreshTick 强制重算 groups；
const refreshTick = ref(0)
const groups = computed(() => { void refreshTick.value; return props.settings.groups() })
// 一级名 → 其下完整分组 key 列表（保持 groups() 原序）
const sectionMap = computed<Map<string, string[]>>(() => {
  const m = new Map<string, string[]>()
  for (const g of groups.value) {
    const nav = navOf(g)
    if (!m.has(nav)) m.set(nav, [])
    m.get(nav)!.push(g)
  }
  return m
})

// —— 当前激活的一级导航（左侧一级名 / 或纯自定义 nav id）——
// 右侧永远展示"该一级下全部二级块"叠成的长列表，靠滚动浏览；点二级只是滚动定位，不再切内容。
const activeNav = ref<string>('')

interface NavEntry {
  key: string
  kind: 'section' | 'nav'
  leaves: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const navEntries = computed<NavEntry[]>(() => {
  const out: NavEntry[] = []
  for (const [nav, leaves] of sectionMap.value) out.push({ key: nav, kind: 'section', leaves })
  const byKey = new Map<string, NavEntry>(out.map((e) => [e.key, e]))
  const occs = [...navList.value].sort((a, b) => a.order - b.order)
  const extras: NavEntry[] = []
  for (const oc of occs) {
    if (oc.id.startsWith('#')) continue
    if (byKey.has(oc.id)) {
      const e = byKey.get(oc.id)!
      e.kind = 'nav'
      e.component = oc.component
    } else {
      extras.push({ key: oc.id, kind: 'nav', leaves: [], component: oc.component })
    }
  }
  out.push(...extras)
  return out
})

/** 左侧一级导航项的激活态 */
function isNavActive(key: string): boolean {
  return activeNav.value === key
}

/** 选中一个一级导航：右侧滚动回该一级的第一段顶部 */
function selectNav(value: string): void {
  if (activeNav.value === value) return
  activeNav.value = value
  void nextTick(scrollToTop)
}

// 分组/导航变化时，确保 activeNav 仍指向一个存在的导航项（默认第一个一级）
watch(
  [groups, navEntries],
  () => {
    const navSet = new Set(navEntries.value.map((e) => e.key))
    if (navEntries.value.length && !navSet.has(activeNav.value)) activeNav.value = navEntries.value[0].key
  },
  { immediate: true },
)

// —— 当前一级下的有序"段"（sections）：每个完整二级/扁平分组占一段，叠成右侧长列表 ——
interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const sections = computed<Section[]>(() => {
  const nav = activeNav.value
  const leaves = sectionMap.value.get(nav) ?? []
  const occs = [...tabList.value]
    .sort((a, b) => a.order - b.order)
    // settingsTab 只对"id 首段 === 当前一级名"的项生效（避免跨一级串扰）
    .filter((oc) => oc.id.startsWith(nav + SEP))
  const occByLeaf = new Map<string, SlotOcc>()
  const customs: SlotOcc[] = []
  for (const oc of occs) {
    if (leaves.includes(oc.id)) occByLeaf.set(oc.id, oc)
    else customs.push(oc)
  }
  const out: Section[] = []
  for (const leaf of leaves) {
    const occ = occByLeaf.get(leaf)
    out.push(
      occ
        ? { key: leaf, label: leafLabelOf(leaf), kind: 'tab', component: occ.component }
        : { key: leaf, label: leafLabelOf(leaf), kind: 'leaf' },
    )
  }
  for (const oc of customs) out.push({ key: oc.id, label: leafLabelOf(oc.id), kind: 'tab', component: oc.component })
  return out
})

// —— 右侧滚动容器 + 当前"正在视口顶部"的段（scroll-spy，用于高亮对应 tab）——
const scrollEl = ref<HTMLElement | null>(null)
const currentSection = ref<string>('')
function scrollToTop(): void {
  const cont = scrollEl.value
  if (cont) cont.scrollTop = 0
  if (sections.value.length) currentSection.value = sections.value[0].key
}
function scrollToSection(key: string): void {
  const cont = scrollEl.value
  if (!cont) return
  const el = cont.querySelector<HTMLElement>(`.psd-section[data-sec="${cssEscape(key)}"]`)
  if (!el) return
  const target = el.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop
  cont.scrollTo({ top: target, behavior: 'smooth' })
  currentSection.value = key
}
function onBodyScroll(): void {
  const cont = scrollEl.value
  if (!cont) return
  const ctop = cont.getBoundingClientRect().top
  let best = ''
  for (const s of sections.value) {
    const el = cont.querySelector<HTMLElement>(`.psd-section[data-sec="${cssEscape(s.key)}"]`)
    if (el && el.getBoundingClientRect().top <= ctop + 6) best = s.key
  }
  if (best) currentSection.value = best
}
// 切换一级时，若该一级只有一段也置高亮；否则滚回顶部
watch(sections, () => { void nextTick(scrollToTop) })

/** CSS.escape 兜底：section key 含 `/`、中文等字符也能安全用于属性选择器 */
function cssEscape(v: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const es = (globalThis as any).CSS?.escape
  return typeof es === 'function' ? es(v) : v.replace(/["\\]/g, '')
}

// —— 每个段的正文：默认 schema 控件 + settingsGroup/<key> 内容插槽，统一成"内容块列表" ——
// 内容插槽 occupant 可经 meta.mode 声明摆放：prepend / append / replace(缺省，接管整组)
function slotMode(oc: SlotOcc): 'replace' | 'prepend' | 'append' {
  const m = (oc.meta as { mode?: string } | undefined)?.mode
  return m === 'prepend' ? 'prepend' : m === 'append' ? 'append' : 'replace'
}
type ContentBlock =
  | { kind: 'field'; key: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'slot'; occ: SlotOcc }

/** 插件装卸/变更 → 递增版本号，让内容插槽 occupants 重读（与 schema/分组刷新解耦但同源触发） */
const occTick = ref(0)
function bumpOcc(): void { occTick.value += 1 }
disposers.push(
  ctx.on('ctx:plugin-installed', bumpOcc),
  ctx.on('ctx:plugin-uninstalled', bumpOcc),
)

/** 取某段自己的渲染内容块（现取，不缓存，靠 occTick/响应式重算） */
function blocksOf(sectionKey: string): ContentBlock[] {
  void occTick.value
  void refreshTick.value
  const occs = ctx.slots
    .occupants('settingsGroup/' + sectionKey)
    .map((e) => ({ id: e.id, order: e.order, component: markRaw(e.component as object), meta: e.meta }))
  const fields = props.settings.groupOf(sectionKey)
  if (!occs.length) return fields.map((e) => ({ kind: 'field' as const, key: e.key }))
  const coexist = occs.some((o) => slotMode(o) !== 'replace')
  const sorted = (m: string) => occs.filter((o) => slotMode(o) === m).sort((a, b) => a.order - b.order)
  const blocks: ContentBlock[] = []
  blocks.push(...sorted('prepend').map((o) => ({ kind: 'slot' as const, occ: o })))
  if (coexist) blocks.push(...fields.map((e) => ({ kind: 'field' as const, key: e.key })))
  blocks.push(...sorted('replace').map((o) => ({ kind: 'slot' as const, occ: o })))
  blocks.push(...sorted('append').map((o) => ({ kind: 'slot' as const, occ: o })))
  return blocks
}

// —— 关闭：✕ / 遮罩 / Esc（closeOnMask 才响应遮罩与 Esc）——
function close(): void {
  emit('close')
  ctx.emit('settings:ui-close')
}
function onMaskClick(): void {
  if (props.closeOnMask !== false) close()
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closeOnMask !== false) close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="psd-mask" @click="onMaskClick">
      <div class="psd-dialog" role="dialog" aria-modal="true" @click.stop>
        <!-- 弹窗头 -->
        <div class="psd-head">
          <div class="psd-title-block">
            <span class="psd-eyebrow">偏好</span>
            <h2 class="psd-title">设置</h2>
          </div>
          <button class="psd-close" aria-label="关闭" title="关闭" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
            </svg>
          </button>
        </div>

        <div class="psd-body">
          <!-- 左：一级导航 -->
          <nav class="psd-nav">
            <div v-if="!navEntries.length" class="psd-nav-empty">暂无分组</div>
            <div v-for="item in navEntries" :key="item.key" class="psd-nav-item"
              :class="{ active: isNavActive(item.key), slot: item.kind === 'nav' }" role="button" tabindex="0"
              @click="selectNav(item.key)" @keydown.enter.prevent="selectNav(item.key)">
              <!-- 默认一级项：分组没有图标，直接显示一级名文本（nav label = group 第一个 / 分段；扁平分组即它自己） -->
              <span v-if="item.kind === 'section'" class="psd-nav-inner">
                <span class="psd-nav-txt">{{ item.key }}</span>
              </span>
              <!-- 一级导航插槽顶替/自定义项：渲染插槽组件，注入 { group, active, onSelect } 能力 -->
              <component v-else :is="item.component" :group="item.key" :active="isNavActive(item.key)"
                :on-select="selectNav" />
            </div>
          </nav>

          <!-- 右：该一级下全部二级块叠成"可滚动长列表"；顶部 tab 只做滚动定位（scroll-spy 高亮当前段） -->
          <div class="psd-content">
            <!-- 目录条：本一级下的各段（仅一段时不显示目录） -->
            <div v-if="sections.length > 1" class="psd-tabs" role="tablist">
              <template v-for="s in sections" :key="s.key">
                <!-- settingsTab 插槽（顶替/追加）：渲染插槽组件注入 { group, active, onSelect }；active 由滚动定位高亮 -->
                <component v-if="s.kind === 'tab'" :is="s.component" :group="s.key"
                  :active="currentSection === s.key" :on-select="scrollToSection" class="psd-tab-item" />
                <!-- 默认目录项：点击滚动到该段 -->
                <button v-else class="psd-tab-item" :class="{ active: currentSection === s.key }"
                  @click="scrollToSection(s.key)">
                  {{ s.label }}
                </button>
              </template>
            </div>

            <div ref="scrollEl" class="psd-content-body" @scroll="onBodyScroll">
              <div v-if="!sections.length" class="psd-empty"><p>暂无分组</p></div>
              <section v-for="s in sections" :key="s.key" class="psd-section" :data-sec="s.key">
                <h4 class="psd-section-title" :class="{ current: currentSection === s.key }">{{ s.label }}</h4>
                <div class="psd-section-body">
                  <template v-for="b in blocksOf(s.key)"
                    :key="(b as any).kind === 'field' ? 'f-' + (b as any).key : 's-' + (b as any).occ.id">
                    <SettingsSchemaField v-if="b.kind === 'field'" :group="s.key" :field-key="b.key"
                      :settings="props.settings" />
                    <component v-else :is="b.occ.component" :group="s.key" :settings="props.settings" />
                  </template>
                  <div v-if="!blocksOf(s.key).length" class="psd-empty">
                    <p>这个分组还没有可配置项</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.psd-mask {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}

.psd-dialog {
  width: min(920px, 100%);
  height: min(68vh, 780px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  color: #374151;
  font-size: 13px;
  animation: psd-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.psd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.psd-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}

.psd-eyebrow {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.psd-title {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.psd-close {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-close svg {
  width: 16px;
  height: 16px;
}

.psd-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #ef4444;
}

.psd-body {
  flex: 1;
  display: flex;
  min-height: 0;
  padding-top: 8px;
}

.psd-nav {
  width: 212px;
  flex-shrink: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  padding: 2px 6px 6px 2px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.psd-nav-empty {
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}

.psd-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  padding: 6px 10px;
  margin-bottom: 2px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  color: #374151;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.psd-nav-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.psd-nav-item.active {
  background: rgba(8, 145, 178, 0.12);
}

.psd-nav-item:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -1px;
}

.psd-nav-item.slot {
  display: block;
  padding: 0;
}

.psd-nav-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.psd-nav-txt {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.psd-nav-item.active .psd-nav-txt {
  color: #0e7490;
  font-weight: 700;
}

.psd-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-left: 8px;
}

/* ===== 二级页签条（仅一级下二级分组多于一个时出现）：编辑器式下划线 tab ===== */
.psd-tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  flex-shrink: 0;
  padding: 8px 12px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  margin-bottom: 0;
}

.psd-tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 9px 16px 11px;
  border: 0;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.16s ease;
}

.psd-tab-item:hover {
  color: #111827;
}

/* active 态：文字变主题色 + 底部一条 2px 指示线 */
.psd-tab-item.active {
  color: #0891b2;
}

.psd-tab-item.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: #0891b2;
}

.psd-tab-item:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -2px;
}

/* ===== 每个二级块一段（右侧长列表里叠排） ===== */
.psd-section {
  padding: 4px 0 8px;
}

/* 段标题：把"当前"段标题高亮成主题色，作为滚动定位的可读反馈 */
.psd-section-title {
  margin: 0 0 6px;
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.psd-section-title.current {
  color: #0891b2;
}

.psd-section-body {
  padding-top: 2px;
}

/* 段内字段分隔交给 sf-field 自己的 border-top；段之间留白即可 */
.psd-section + .psd-section {
  margin-top: 6px;
}

.psd-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 2px 16px 20px 16px;
  min-height: 0;
  scrollbar-width: thin;
  scroll-behavior: smooth;
}

.psd-empty {
  padding: 24px 10px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.psd-empty p {
  margin: 0;
}

/* ============ 动画 ============ */
@keyframes psd-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.psd-content-body::-webkit-scrollbar,
.psd-nav::-webkit-scrollbar {
  width: 8px;
}
.psd-content-body::-webkit-scrollbar-thumb,
.psd-nav::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.psd-content-body::-webkit-scrollbar-thumb:hover,
.psd-nav::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .psd-dialog {
    animation: none !important;
    transition: none !important;
  }
}
</style>
