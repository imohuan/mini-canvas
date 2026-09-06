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
type SlotOcc = { id: string; order: number; component: any }

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
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

// —— 当前激活 key（默认第一个分组）——
const groups = computed(() => props.settings.groups())
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
    .map((e) => ({ id: e.id, order: e.order, component: markRaw(e.component as object) }))
}
watch(activeKey, reloadContent)
disposers.push(
  ctx.on('ctx:plugin-installed', reloadContent),
  ctx.on('ctx:plugin-uninstalled', reloadContent),
)
reloadContent() // 首帧读一次内容插槽

const activeFields = computed(() => props.settings.groupOf(activeKey.value))
const hasContentSlot = computed(() => contentList.value.length > 0)

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
          <span class="psd-title">⚙ 设置</span>
          <button class="psd-close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="psd-body">
          <!-- 左：导航 -->
          <nav class="psd-nav">
            <div v-if="!navEntries.length" class="psd-nav-empty">暂无分组</div>
            <div
              v-for="item in navEntries"
              :key="item.key"
              class="psd-nav-item"
              :class="{ active: activeKey === item.key }"
              role="button"
              tabindex="0"
              @click="onSelect(item.key)"
              @keydown.enter.prevent="onSelect(item.key)"
            >
              <!-- 分组默认项：直接画文本 -->
              <span v-if="item.kind === 'group'">{{ item.key }}</span>
              <!-- 导航插槽顶替/自定义项：渲染插槽组件，注入 { group, active, onSelect } 能力 -->
              <component
                v-else
                :is="item.component"
                :key="item.key"
                :group="item.key"
                :active="activeKey === item.key"
                :on-select="onSelect"
              />
            </div>
          </nav>

          <!-- 右：标题 + 内容 -->
          <div class="psd-content">
            <header class="psd-content-head">
              <h3 class="psd-content-title">{{ activeKey }}</h3>
              <span class="psd-content-sub">{{ activeKey }} 设置</span>
            </header>

            <div class="psd-content-body">
              <!-- 内容插槽接管（有人注册 settingsGroup/<key>） -->
              <template v-if="hasContentSlot">
                <component
                  v-for="oc in contentList"
                  :key="oc.id"
                  :is="oc.component"
                  :group="activeKey"
                  :settings="props.settings"
                />
              </template>
              <!-- fallback：schema 渲染该分组全部控件 -->
              <template v-else-if="activeFields.length">
                <SettingsSchemaField
                  v-for="e in activeFields"
                  :key="e.key"
                  :group="activeKey"
                  :field-key="e.key"
                  :settings="props.settings"
                />
              </template>
              <!-- 空态 -->
              <div v-else class="psd-empty">
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
  z-index: 2000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}
.psd-dialog {
  width: 720px;
  max-width: calc(100vw - 48px);
  height: 480px;
  max-height: calc(100vh - 96px);
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 12.5px;
  color: #1f2937;
}
.psd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #eef0f3;
  flex-shrink: 0;
}
.psd-title {
  font-size: 14px;
  font-weight: 600;
}
.psd-close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 15px;
  color: #9aa3af;
  padding: 2px 8px;
  border-radius: 6px;
}
.psd-close:hover {
  background: #f1f3f5;
  color: #1f2937;
}
.psd-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.psd-nav {
  width: 190px;
  flex-shrink: 0;
  border-right: 1px solid #eef0f3;
  padding: 10px 8px;
  overflow-y: auto;
  background: #fafbfc;
}
.psd-nav-empty {
  color: #9aa3af;
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}
.psd-nav-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 8px 12px;
  margin-bottom: 2px;
  border-radius: 8px;
  font-size: 12.5px;
  color: #374151;
  cursor: pointer;
}
.psd-nav-item:hover {
  background: #eef2ff;
}
.psd-nav-item.active {
  background: #4f7cff;
  color: #fff;
  font-weight: 600;
}
.psd-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.psd-content-head {
  padding: 14px 18px 10px;
  border-bottom: 1px solid #f0f1f3;
  flex-shrink: 0;
}
.psd-content-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.psd-content-sub {
  display: inline-block;
  margin-top: 4px;
  font-size: 11px;
  color: #9aa3af;
}
.psd-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 16px;
  min-height: 0;
}
.psd-empty {
  padding: 24px 10px;
  text-align: center;
  color: #9aa3af;
  font-size: 12px;
}
.psd-empty p {
  margin: 0;
}
</style>
