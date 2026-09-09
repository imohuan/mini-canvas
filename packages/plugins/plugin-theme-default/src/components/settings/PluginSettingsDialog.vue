<script setup lang="ts">
/**
 * PluginSettingsDialog —— theme-default 的默认设置面板皮（Dialog + 左右导航版）。
 *
 * 定位：可替换设置面板 settingsPanel 槽的默认赢家，被 <SettingsHost/> 渲染（喂 props.settings）。
 * 从"一列堆叠分组卡片"重构为**居中 modal 弹窗 + 左右布局的标准设置界面**：
 *   - 左 = 分组导航（一项 = 一个 key，默认来自 config 分组；可被"导航插槽"同 key 顶替或追加自定义项）
 *   - 右 = 上下两块：上为当前项标题(分组名)，下为内容区
 * 依赖方向：plugin-theme-default → canvas-render(useCanvasRender 拿 ctx) → canvas-core-v2，不反向。
 *
 * 两套可扩展插槽（用内核 ctx.slots 多 occupant 机制，插件 ctx.slots.register 填充，装卸自动回收）：
 *   1) 左导航插槽  `settingsNav`    — 插件塞自定义导航项 / 顶替某分组 tab。
 *      occupant 注册 id：
 *        - id === 某 config 分组名  → 顶替该分组的默认 tab（左侧该位显示插槽组件，不再渲染默认项）
 *        - id 不命中任何分组        → 作为"纯自定义导航项"追加（右侧需配 content 插槽接管渲染，见下）
 *      occupant 组件通过 props 收到 { key, active, onSelect } —— onSelect(key) 切右侧，不给则点了没反应。
 *   2) 右内容插槽  `settingsGroup/<key>` — 接管某 key 的右侧内容区渲染。
 *      - 有 occupant → 渲染它们（props 给 { key, settings }），接管该 key 内容；
 *      - 无 occupant → fallback：按 schema 渲染该分组全部控件（SettingsSchemaField），分组来自 settings.groupOf(key)。
 *
 * 打开/关闭：宿主(App.vue)用 v-if="settingsOpen" 控制本面板是否渲染；本面板内部 ✕ / 点遮罩 / Esc
 * 经 ctx.emit('settings:ui-close') 通知宿主关闭（宿主 onReady 里 ctx.on 订阅置 settingsOpen=false）。
 */
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { useCanvasRender } from '@mini-canvas/canvas-render'
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
const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reloadNav),
  ctx.on('ctx:plugin-uninstalled', reloadNav),
)
// P2-1：内核 schema 变更订阅 → 强制刷新分组列表（插件热装卸后新 config 分组立即可见）
const rawSettings = ctx.get<{ onSchemaChange(cb: () => void): { dispose(): void } }>('settings')
const schemaOff = rawSettings?.onSchemaChange(() => { refreshTick.value += 1 })
if (schemaOff) disposers.push(schemaOff)
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

// —— 当前激活 key（默认第一个分组）——
// P2-1：schema 变化（插件热装卸 define/移除项）经 settings.onSchemaChange 置 refreshTick 强制重算 groups；
// 不再只依赖 nav/content 间接触发重渲染。
const refreshTick = ref(0)
const groups = computed(() => { void refreshTick.value; return props.settings.groups() })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeKey = ref<string>('')
watch(
  groups,
  (g) => {
    if (!g.length) activeKey.value = ''
    else if (!g.includes(activeKey.value)) activeKey.value = g[0]
  },
  { immediate: true },
)

/** 合并成左侧导航条目：config 分组(按序) + 导航插槽(同 key 顶替 / 新 key 追加) */
interface NavEntry {
  key: string
  kind: 'group' | 'nav'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const navEntries = computed<NavEntry[]>(() => {
  const gs = groups.value
  const map = new Map<string, NavEntry>()
  gs.forEach((k) => map.set(k, { key: k, kind: 'group' }))
  // 导航插槽：id 命中分组名 → 顶替该位；否则先攒着末尾追加
  const occs = [...navList.value].sort((a, b) => a.order - b.order)
  const extra: NavEntry[] = []
  for (const oc of occs) {
    if (map.has(oc.id)) map.set(oc.id, { key: oc.id, kind: 'nav', component: oc.component })
    else if (!oc.id.startsWith('#')) extra.push({ key: oc.id, kind: 'nav', component: oc.component })
  }
  // 分组保持 groups() 原顺序（被顶替位即 nav 组件）；纯自定义项追加在末尾
  const out: NavEntry[] = []
  gs.forEach((k) => {
    const e = map.get(k)!
    if (!out.some((o) => o.key === e.key)) out.push(e)
  })
  for (const e of extra) {
    if (!out.some((o) => o.key === e.key)) out.push(e)
  }
  return out
})

/** 右内容区插槽 occupants（接管某 key 的内容渲染）；无则走 schema fallback */
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

/** 选中某个导航 key → 切右侧 */
function onSelect(key: string): void {
  activeKey.value = key
  reloadContent()
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
          <!-- 左：导航 -->
          <nav class="psd-nav">
            <div v-if="!navEntries.length" class="psd-nav-empty">暂无分组</div>
            <div v-for="item in navEntries" :key="item.key" class="psd-nav-item"
              :class="{ active: activeKey === item.key, slot: item.kind === 'nav' }" role="button" tabindex="0" @click="onSelect(item.key)"
              @keydown.enter.prevent="onSelect(item.key)">
              <!-- 分组默认项：直接画文本 -->
              <span v-if="item.kind === 'group'" class="psd-nav-inner">
                <span class="psd-nav-ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/>
                    <path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>
                  </svg>
                </span>
                <span class="psd-nav-txt">{{ item.key }}</span>
              </span>
              <!-- 导航插槽顶替/自定义项：渲染插槽组件，注入 { group, active, onSelect } 能力 -->
              <component v-else :is="item.component" :key="item.key" :group="item.key" :active="activeKey === item.key"
                :on-select="onSelect" />
            </div>
          </nav>

          <!-- 右：标题 + 内容 -->
          <div class="psd-content">
            <header class="psd-content-head">
              <h3 class="psd-content-title">{{ activeKey }}</h3>
              <span class="psd-content-sub">{{ activeKey }} 设置</span>
            </header>

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

.psd-nav-ico {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #6b7280;
  background: rgba(0, 0, 0, 0.04);
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-nav-ico svg {
  width: 16px;
  height: 16px;
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

.psd-nav-item:hover .psd-nav-ico {
  background: rgba(0, 0, 0, 0.08);
}

.psd-nav-item.active .psd-nav-ico {
  color: #0891b2;
  background: rgba(8, 145, 178, 0.16);
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
  padding: 10px 10px 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
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
