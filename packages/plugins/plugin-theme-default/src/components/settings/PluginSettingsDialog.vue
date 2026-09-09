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
import { computed, markRaw, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
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

// —— 分组 key → 当前激活 leaf ——
// P2-1：schema 变化（插件热装卸 define/移除项）经 settings.onSchemaChange 置 refreshTick 强制重算 groups；
// 不再只依赖 nav/content 间接触发重渲染。
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

// 当前激活的**完整分组 key**（二级菜单里是叶子，扁平分组就是它自己；自定义导航项则可能不在任何分组里）
const activeKey = ref<string>('')

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

// 分组/导航项变化时，确保 activeKey 仍指向一个存在的 leaf 或一级/自定义项
watch(
  [groups, navEntries],
  () => {
    const leafSet = new Set(groups.value)
    const navSet = new Set(navEntries.value.map((e) => e.key))
    if (!groups.value.length) activeKey.value = ''
    else if (!leafSet.has(activeKey.value) && !navSet.has(activeKey.value)) activeKey.value = groups.value[0]
  },
  { immediate: true },
)

// —— 二级页签：当前一级下的有序 tabs（默认 leaf + settingsTab 顶替/追加）——
interface TabEntry {
  key: string
  kind: 'leaf' | 'tab'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const tabs = computed<TabEntry[]>(() => {
  const nav = navOf(activeKey.value)
  const leaves = sectionMap.value.get(nav) ?? []
  const occs = [...tabList.value]
    .sort((a, b) => a.order - b.order)
    // settingsTab 只对"id 首段 === 当前一级名"的分组/自定义项生效（避免跨一级串扰）
    .filter((oc) => oc.id.startsWith(nav + SEP))
  const occByLeaf = new Map<string, SlotOcc>()
  const customs: SlotOcc[] = []
  for (const oc of occs) {
    if (leaves.includes(oc.id)) occByLeaf.set(oc.id, oc)
    else customs.push(oc)
  }
  const out: TabEntry[] = []
  for (const leaf of leaves) {
    const occ = occByLeaf.get(leaf)
    out.push(occ ? { key: leaf, kind: 'tab', component: occ.component } : { key: leaf, kind: 'leaf' })
  }
  for (const oc of customs) out.push({ key: oc.id, kind: 'tab', component: oc.component })
  return out
})
/** 当前一级下是否有多于一个二级页签：是才显示 tab 条，否则直接展示正文（需求：只有一个 tab 就不显示） */
const showTabs = computed(() => tabs.value.length > 1)

// 一级导航项的激活态：当前激活 key 的一级名 === 该项 key
function isNavActive(key: string): boolean {
  return !!activeKey.value && navOf(activeKey.value) === key
}

/** 选中：给一级名 → 取其第一个 leaf；给完整 key/自定义 id → 直接用它。右侧据此切内容。 */
function select(value: string): void {
  const leaves = sectionMap.value.get(value)
  activeKey.value = leaves && leaves.length ? leaves[0] : value
  reloadContent()
}

/** 右内容区插槽 occupants（接管某完整 key 的内容渲染）；无则走 schema fallback */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const contentList = ref<SlotOcc[]>([])
function contentSlotName(key: string): string {
  return 'settingsGroup/' + key
}
function reloadContent(): void {
  contentList.value = ctx.slots
    .occupants(contentSlotName(activeKey.value))
    .map((e) => ({
      id: e.id,
      order: e.order,
      component: markRaw(e.component as object),
      meta: e.meta,
    }))
}
watch(activeKey, reloadContent)
disposers.push(
  ctx.on('ctx:plugin-installed', reloadContent),
  ctx.on('ctx:plugin-uninstalled', reloadContent),
)
reloadContent() // 首帧读一次内容插槽

const activeFields = computed(() => props.settings.groupOf(activeKey.value))

// —— 内容区统一渲染成"有序内容块列表"：默认控件(schema) 与 插槽组件都是块，模板就一段 v-for ——
// 每个内容插槽 occupant 可经 meta.mode 声明摆放：
//   'prepend' → 与默认控件并存，排在最前
//   'append'  → 与默认控件并存，排在默认控件之后
//   其它/缺省 → 'replace'：接管整组（不渲染默认控件，向后兼容旧行为）
// 规则：只要有 occupant 要求并存(replace 之外的 mode)，就把默认控件块也放进列表；
//       否则（全 replace 或该组无字段）列表里只有插槽块/默认块。
function slotMode(oc: SlotOcc): 'replace' | 'prepend' | 'append' {
  const m = (oc.meta as { mode?: string } | undefined)?.mode
  return m === 'prepend' ? 'prepend' : m === 'append' ? 'append' : 'replace'
}
/** 当前分组的渲染内容块（有序）：[prepend 插槽…] [schema 默认控件…] [append/replace 插槽…] */
type ContentBlock =
  | { kind: 'field'; key: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'slot'; occ: SlotOcc }
const contentBlocks = computed<ContentBlock[]>(() => {
  const occs = contentList.value
  // 无插槽 → 纯默认控件
  if (!occs.length) return activeFields.value.map((e) => ({ kind: 'field' as const, key: e.key }))
  const coexist = occs.some((o) => slotMode(o) !== 'replace')
  const sorted = (m: string) => occs.filter((o) => slotMode(o) === m).sort((a, b) => a.order - b.order)
  const blocks: ContentBlock[] = []
  blocks.push(...sorted('prepend').map((o) => ({ kind: 'slot' as const, occ: o })))
  if (coexist) blocks.push(...activeFields.value.map((e) => ({ kind: 'field' as const, key: e.key })))
  blocks.push(...sorted('replace').map((o) => ({ kind: 'slot' as const, occ: o })))
  blocks.push(...sorted('append').map((o) => ({ kind: 'slot' as const, occ: o })))
  return blocks
})

// 右侧头部标题：一级下有多个二级时显示一级名（页签表二级）；否则显示完整 key（保持扁平分组观感）
const headTitle = computed(() => (showTabs.value ? navOf(activeKey.value) : activeKey.value))

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
              @click="select(item.key)" @keydown.enter.prevent="select(item.key)">
              <!-- 默认一级项：分组没有图标，直接显示一级名文本（nav label = group 第一个 / 分段；扁平分组即它自己） -->
              <span v-if="item.kind === 'section'" class="psd-nav-inner">
                <span class="psd-nav-txt">{{ item.key }}</span>
              </span>
              <!-- 一级导航插槽顶替/自定义项：渲染插槽组件，注入 { group, active, onSelect } 能力 -->
              <component v-else :is="item.component" :group="item.key" :active="isNavActive(item.key)"
                :on-select="select" />
            </div>
          </nav>

          <!-- 右：标题 + (二级页签) + 内容 -->
          <div class="psd-content">
            <header class="psd-content-head">
              <h3 class="psd-content-title">{{ headTitle }}</h3>
              <span class="psd-content-sub">{{ headTitle }} 设置</span>
            </header>

            <!-- 二级页签条：仅当一级下二级分组多于一个才显示（settingsNav 语义对称） -->
            <div v-if="showTabs" class="psd-tabs" role="tablist">
              <template v-for="t in tabs" :key="t.key">
                <!-- 二级页签插槽（顶替/追加）：渲染插槽组件注入 { group, active, onSelect } -->
                <component v-if="t.kind === 'tab'" :is="t.component" :group="t.key"
                  :active="activeKey === t.key" :on-select="select" class="psd-tab-item" />
                <!-- 默认二级页签：点它切到该完整分组 key -->
                <button v-else class="psd-tab-item" :class="{ active: activeKey === t.key }" @click="select(t.key)">
                  {{ leafLabelOf(t.key) }}
                </button>
              </template>
            </div>

            <div class="psd-content-body">
              <!-- 内容区 = 一段 v-for 遍历"有序内容块"(contentBlocks)：field(默认控件) / slot(插槽组件) 就地分支渲染 -->
              <template v-for="b in contentBlocks"
                :key="(b as any).kind === 'field' ? 'f-' + (b as any).key : 's-' + (b as any).occ.id">
                <SettingsSchemaField v-if="b.kind === 'field'" :group="activeKey" :field-key="b.key"
                  :settings="props.settings" />
                <component v-else :is="b.occ.component" :group="activeKey" :settings="props.settings" />
              </template>
              <!-- 空态 -->
              <div v-if="!contentBlocks.length" class="psd-empty">
                <p>这个分组还没有可配置项</p>
              </div>
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

.psd-content-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 10px 6px 16px;
  flex-shrink: 0;
}

.psd-content-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
}

.psd-content-sub {
  display: inline-block;
  font-size: 12px;
  color: #9ca3af;
  font-weight: 500;
}

/* ===== 二级页签条（仅一级下二级分组多于一个时出现） ===== */
.psd-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding: 0 16px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  margin-bottom: 0;
}

.psd-tab-item {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #6b7280;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.psd-tab-item:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #374151;
}

.psd-tab-item.active {
  background: #0891b2;
  color: #fff;
}

.psd-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 16px 16px 16px;
  min-height: 0;
  scrollbar-width: thin;
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
