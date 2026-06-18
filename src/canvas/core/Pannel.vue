<script setup lang="ts">
import { ref, computed } from 'vue'
import { ConnectionMode } from '@vue-flow/core'
import type { EdgeType } from './useCanvasStore'
import type { StorageStatus, ProjectMeta } from './plugins/storage/StoragePlugin'

// ===========================
// Props & Emits
// ===========================
export interface ToggleDef {
  key: string
  label: string
  get: () => boolean
  set: (v: boolean) => void
  tip?: string
}

export interface PluginDef {
  name: string
  label: string
  description: string
  enabled: boolean
}

const props = defineProps<{
  toggles: ToggleDef[]
  connectionMode: ConnectionMode
  edgeLineWidth: number
  edgeColor: string
  edgeType: EdgeType
  edgeDashed: boolean
  edgeAnimated: boolean
  minZoom: number
  maxZoom: number
  topToolbarOffset: number
  bottomToolbarOffset: number
  handleDebug: boolean
  handleRadius: number
  handleRestOffset: number
  handleCursorGap: number
  handleButtonSize: number
  handleOverlap: number
  connectionSnapDebugVisible: boolean
  connectionSnapOuterRatio: number
  connectionSnapInnerRatio: number
  connectionSnapHeightRatio: number
  selectionFramePaddingX: number
  selectionFramePaddingTop: number
  selectionFramePaddingBottom: number
  plugins?: PluginDef[]
  /** 主题预设名称 */
  themePreset?: string
  /** 当前主题 accent 色 */
  themeAccent?: string
  /** 当前主题 surface 色 */
  themeSurface?: string
  /** 存储插件状态 */
  storageStatus?: StorageStatus & { projects: ProjectMeta[] }
}>()

const emit = defineEmits<{
  (e: 'toggleMode'): void
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'fitView'): void
  (e: 'update:edgeLineWidth', v: number): void
  (e: 'update:edgeColor', v: string): void
  (e: 'update:edgeType', v: EdgeType): void
  (e: 'toggleEdgeDashed'): void
  (e: 'toggleEdgeAnimated'): void
  (e: 'update:minZoom', v: number): void
  (e: 'update:maxZoom', v: number): void
  (e: 'update:topToolbarOffset', v: number): void
  (e: 'update:bottomToolbarOffset', v: number): void
  (e: 'update:handleDebug', v: boolean): void
  (e: 'update:handleRadius', v: number): void
  (e: 'update:handleRestOffset', v: number): void
  (e: 'update:handleCursorGap', v: number): void
  (e: 'update:handleButtonSize', v: number): void
  (e: 'update:handleOverlap', v: number): void
  (e: 'update:connectionSnapDebugVisible', v: boolean): void
  (e: 'update:connectionSnapOuterRatio', v: number): void
  (e: 'update:connectionSnapInnerRatio', v: number): void
  (e: 'update:connectionSnapHeightRatio', v: number): void
  (e: 'update:selectionFramePaddingX', v: number): void
  (e: 'update:selectionFramePaddingTop', v: number): void
  (e: 'update:selectionFramePaddingBottom', v: number): void
  /** 应用主题预设 */
  (e: 'applyThemePreset', name: string): void
  /** 应用自定义主题色 */
  (e: 'applyCustomTheme', accent: string): void
  /** 存储操作 */
  (e: 'storageConnect'): void
  (e: 'storageDisconnect'): void
  (e: 'storageCreateProject', name: string): void
  (e: 'storageDeleteProject', id: string): void
  (e: 'storageSwitchProject', id: string): void
}>()

// ===========================
// 折叠状态
// ===========================
const collapsed = ref(true)

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}

// ===========================
// Tab 状态
// ===========================
type TabKey = 'general' | 'theme' | 'storage'
const activeTab = ref<TabKey>('general')

const tabs: { key: TabKey; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'theme', label: '主题' },
  { key: 'storage', label: '存储' },
]

// ===========================
// Computed
// ===========================
const modeLabel = computed(() =>
  props.connectionMode === ConnectionMode.Strict ? '严格' : '宽松'
)

const edgeTypeOptions: { value: EdgeType; label: string }[] = [
  { value: 'bezier', label: '贝塞尔' },
  { value: 'straight', label: '直线' },
  { value: 'step', label: '阶梯' },
]

const edgeColorPresets = ['#3b82f6', '#1677ff', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899']

const themePresets = [
  { name: 'slate', label: '灰蓝', color: '#111827' },
  { name: 'blue', label: '科技蓝', color: '#1d4ed8' },
  { name: 'green', label: '翠绿', color: '#166534' },
  { name: 'warm', label: '暖棕', color: '#78350f' },
]

const storage = computed(() => props.storageStatus)
const storageProjects = computed(() => storage.value?.projects || [])

const modeLabelText: Record<string, string> = {
  localStorage: 'localStorage',
  filesystem: '文件系统',
  none: '未连接',
}

// ===========================
// New project input state
// ===========================
const showNewProjectInput = ref(false)
const newProjectName = ref('')

function onAddProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  emit('storageCreateProject', name)
  newProjectName.value = ''
  showNewProjectInput.value = false
}

// ===========================
// Style: Ax UI Kit Design Tokens
// ===========================
// Tab button
const tabBase = 'flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors duration-200 cursor-pointer select-none'
const tabActive = 'bg-[#000000] text-white shadow-sm'
const tabInactive = 'text-[#47464a] hover:text-[#1a1c1d] hover:bg-[#f3f3f4]'

// Section
const sectionCard = 'bg-[#ffffff] border border-[#c8c5ca] rounded-lg overflow-hidden'
const sectionHeader = 'px-3 py-1.5 border-b border-[#c8c5ca] bg-[#f3f3f4] flex items-center gap-1.5'
const sectionBody = 'p-3 divide-y divide-[#c8c5ca]/40'
const sectionBodySpace = 'p-3 space-y-2'

// Labels
const labelClass = 'text-[#47464a] text-[11px] w-9 shrink-0 text-right'
const sectionTitle = 'text-[10px] text-[#78767b] uppercase tracking-wider font-semibold font-mono'

// Buttons
const btnBase = 'border rounded text-[11px] px-2 py-0.5 leading-relaxed cursor-pointer transition-all duration-150 whitespace-nowrap bg-[#f9f9fa] border-[#c8c5ca] text-[#47464a] hover:border-[#000000] hover:text-[#1a1c1d] active:bg-[#e8e8e9]'
const btnActive = '!bg-[#000000] !border-[#000000] !text-white'

// Row layout
const rowBase = 'flex items-center gap-1.5 mb-1.5'
const rowItem = 'flex items-center gap-3 py-2'

// Status badge
function statusBadgeClass(mode: string) {
  return mode === 'filesystem'
    ? 'bg-[#166534]/10 text-[#166534] border border-[#166534]/20'
    : mode === 'localStorage'
      ? 'bg-[#1d4ed8]/10 text-[#1d4ed8] border border-[#1d4ed8]/20'
      : 'bg-[#78767b]/10 text-[#78767b] border border-[#78767b]/20'
}
</script>

<template>
  <div class="bg-white/95 backdrop-blur border border-[#c8c5ca] rounded-xl flex flex-col min-w-[260px] max-h-[85vh] shadow-[0_4px_12px_rgba(0,0,0,0.04)] text-xs select-none font-sans overflow-hidden" :class="collapsed ? '!min-w-0' : ''">

    <!-- ============ Tab 导航栏 ============ -->
    <div class="flex items-center gap-0.5 px-3 pt-3 pb-2 border-b border-[#c8c5ca]/40 bg-[#f9f9fa]">
      <template v-if="!collapsed">
        <button v-for="tab in tabs" :key="tab.key"
          :class="[tabBase, activeTab === tab.key ? tabActive : tabInactive]"
          @click="activeTab = tab.key">
          {{ tab.label }}
        </button>
      </template>
      <!-- 折叠/展开按钮 -->
      <button
        class="ml-auto w-6 h-6 flex items-center justify-center rounded-md text-[#78767b] hover:text-[#1a1c1d] hover:bg-[#e8e8e9] cursor-pointer transition-colors shrink-0"
        :title="collapsed ? '展开面板' : '折叠面板'"
        @click="toggleCollapsed">
        <!-- 折叠状态 → 展开图标 (≡) -->
        <svg v-if="collapsed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        <!-- 展开状态 → 折叠图标 (×) -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- ============ 内容区 ============ -->
    <div v-if="!collapsed" class="flex-1 overflow-y-auto p-3 space-y-2">

      <!-- ======================== Tab 1: 通用配置 ======================== -->
      <template v-if="activeTab === 'general'">

        <!-- 已加载插件 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">已加载插件</span>
          </div>
          <div :class="sectionBodySpace">
            <div v-if="plugins && plugins.length > 0" class="flex flex-col gap-1">
              <div v-for="p in plugins" :key="p.name"
                class="flex items-center gap-2 px-2 py-1 rounded"
                :class="p.enabled ? 'bg-[#166534]/5 border border-[#166534]/15' : 'bg-[#f3f3f4] border border-[#c8c5ca]/50'">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="p.enabled ? 'bg-[#22c55e]' : 'bg-[#78767b]'" />
                <span class="text-[11px] font-medium text-[#1a1c1d] truncate flex-1">{{ p.label }}</span>
              </div>
            </div>
            <div v-else class="text-[11px] text-[#78767b] italic px-2">暂无插件加载</div>
          </div>
        </section>

        <!-- 视图控制 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">视图</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowBase">
              <span :class="labelClass">缩放</span>
              <button :class="btnBase" title="放大" @click="emit('zoomIn')">+</button>
              <button :class="btnBase" title="缩小" @click="emit('zoomOut')">−</button>
              <button :class="btnBase" title="适应画布" @click="emit('fitView')">适应</button>
            </div>
          </div>
        </section>

        <!-- 连线控制 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">连线</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowBase">
              <span :class="labelClass">模式</span>
              <button :class="[btnBase, 'flex-1 text-center']" @click="emit('toggleMode')">{{ modeLabel }}</button>
              <button :class="[btnBase, 'flex-1 text-center', toggles.find(t=>t.key==='connectOnClick')?.get() && btnActive]"
                @click="toggles.find(t=>t.key==='connectOnClick')?.set(!toggles.find(t=>t.key==='connectOnClick')?.get())">点击连</button>
            </div>
          </div>
        </section>

        <!-- 连线样式 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">连线样式</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowBase">
              <span :class="labelClass">线型</span>
              <div class="flex gap-0.5 flex-1">
                <button v-for="opt in edgeTypeOptions" :key="opt.value"
                  :class="[btnBase, 'flex-1 text-center', edgeType === opt.value && btnActive]"
                  @click="emit('update:edgeType', opt.value)">{{ opt.label }}</button>
              </div>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">宽度</span>
              <input type="range" min="1" max="6" :value="edgeLineWidth"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:edgeLineWidth', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-8 text-right">{{ edgeLineWidth }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">颜色</span>
              <div class="flex items-center gap-1 flex-wrap flex-1">
                <button v-for="c in edgeColorPresets" :key="c"
                  class="w-4 h-4 rounded-full border-2 cursor-pointer transition-transform hover:scale-125 p-0"
                  :class="edgeColor === c ? '!border-[#000000] shadow-[0_0_0_2px_rgba(0,0,0,0.15)]' : 'border-transparent'"
                  :style="{ background: c }" @click="emit('update:edgeColor', c)" />
                <input type="color" :value="edgeColor"
                  class="w-5 h-5 border-0 p-0 cursor-pointer rounded"
                  @input="emit('update:edgeColor', ($event.target as HTMLInputElement).value)" />
              </div>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">样式</span>
              <button :class="[btnBase, 'flex-1 text-center', edgeDashed && btnActive]" @click="emit('toggleEdgeDashed')">
                {{ edgeDashed ? '虚线' : '实线' }}
              </button>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">动画</span>
              <button :class="[btnBase, 'flex-1 text-center', edgeAnimated && btnActive]" @click="emit('toggleEdgeAnimated')">
                {{ edgeAnimated ? '开' : '关' }}
              </button>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">范围</span>
              <input type="number" :value="minZoom" step="0.1" min="0.1" max="2"
                class="w-14 h-6 border border-[#c8c5ca] rounded px-1 text-[11px] text-center focus:outline-none focus:border-[#000000]"
                @input="emit('update:minZoom', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[#78767b] text-[11px]">~</span>
              <input type="number" :value="maxZoom" step="0.5" min="1" max="10"
                class="w-14 h-6 border border-[#c8c5ca] rounded px-1 text-[11px] text-center focus:outline-none focus:border-[#000000]"
                @input="emit('update:maxZoom', Number(($event.target as HTMLInputElement).value))" />
            </div>
          </div>
        </section>

        <!-- 自定义端口 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">自定义端口</span>
          </div>
          <div :class="sectionBodySpace">
            <label class="flex items-center gap-1.5 cursor-pointer py-0.5 hover:text-[#000000] text-[11px] mb-1">
              <input type="checkbox" :checked="handleDebug" class="w-3 h-3 accent-[#000000] cursor-pointer"
                @change="emit('update:handleDebug', ($event.target as HTMLInputElement).checked)" />
              <span>显示 debug 线框</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer py-0.5 hover:text-[#000000] text-[11px] mb-1">
              <input type="checkbox" :checked="connectionSnapDebugVisible" class="w-3 h-3 accent-[#000000] cursor-pointer"
                @change="emit('update:connectionSnapDebugVisible', ($event.target as HTMLInputElement).checked)" />
              <span>显示吸附区</span>
            </label>
            <div :class="rowBase">
              <span :class="labelClass">半径</span>
              <input type="range" min="40" max="160" :value="handleRadius"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:handleRadius', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ handleRadius }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">回位</span>
              <input type="range" min="8" max="120" :value="handleRestOffset"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:handleRestOffset', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ handleRestOffset }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">避鼠</span>
              <input type="range" min="0" max="80" :value="handleCursorGap"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:handleCursorGap', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ handleCursorGap }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">球径</span>
              <input type="range" min="18" max="56" :value="handleButtonSize"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:handleButtonSize', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ handleButtonSize }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">裁剪</span>
              <input type="range" min="0" max="80" :value="handleOverlap"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:handleOverlap', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ handleOverlap }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">外吸</span>
              <input type="range" min="0" max="2" step="0.05" :value="connectionSnapOuterRatio"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:connectionSnapOuterRatio', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ connectionSnapOuterRatio.toFixed(2) }}</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">内吸</span>
              <input type="range" min="0" max="2" step="0.05" :value="connectionSnapInnerRatio"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:connectionSnapInnerRatio', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ connectionSnapInnerRatio.toFixed(2) }}</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">吸高</span>
              <input type="range" min="0.2" max="3" step="0.05" :value="connectionSnapHeightRatio"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:connectionSnapHeightRatio', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ connectionSnapHeightRatio.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <!-- 多选框 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">多选框</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowBase">
              <span :class="labelClass">左右</span>
              <input type="range" min="0" max="80" :value="selectionFramePaddingX"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:selectionFramePaddingX', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ selectionFramePaddingX }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">上</span>
              <input type="range" min="0" max="100" :value="selectionFramePaddingTop"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:selectionFramePaddingTop', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ selectionFramePaddingTop }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">下</span>
              <input type="range" min="0" max="80" :value="selectionFramePaddingBottom"
                class="flex-1 h-1 accent-[#000000] cursor-pointer"
                @input="emit('update:selectionFramePaddingBottom', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b] w-10 text-right">{{ selectionFramePaddingBottom }}px</span>
            </div>
          </div>
        </section>

        <!-- 节点交互 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">节点交互</span>
          </div>
          <div :class="sectionBodySpace">
            <label v-for="t in toggles.filter(x => ['nodesDraggable','nodesConnectable','elementsSelectable','edgesUpdatable','snapToGrid'].includes(x.key))"
              :key="t.key" class="flex items-center gap-1.5 cursor-pointer py-0.5 hover:text-[#000000] text-[11px]">
              <input type="checkbox" :checked="t.get()" class="w-3 h-3 accent-[#000000] cursor-pointer"
                @change="t.set(($event.target as HTMLInputElement).checked)" />
              <span>{{ t.label }}</span>
            </label>
          </div>
        </section>

        <!-- 视口交互 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">视口交互</span>
          </div>
          <div :class="sectionBodySpace">
            <label v-for="t in toggles.filter(x => ['zoomOnScroll','panOnScroll','panOnDrag','selectNodesOnDrag','onlyRenderVisibleElements'].includes(x.key))"
              :key="t.key" class="flex items-center gap-1.5 cursor-pointer py-0.5 hover:text-[#000000] text-[11px]">
              <input type="checkbox" :checked="t.get()" class="w-3 h-3 accent-[#000000] cursor-pointer"
                @change="t.set(($event.target as HTMLInputElement).checked)" />
              <span>{{ t.label }}</span>
            </label>
          </div>
        </section>

        <!-- 工具栏偏移 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">工具栏</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowBase">
              <span :class="labelClass">上</span>
              <input type="number" :value="topToolbarOffset" min="0" max="60"
                class="w-14 h-6 border border-[#c8c5ca] rounded px-1 text-[11px] text-center focus:outline-none focus:border-[#000000]"
                @input="emit('update:topToolbarOffset', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b]">{{ topToolbarOffset }}px</span>
            </div>
            <div :class="rowBase">
              <span :class="labelClass">下</span>
              <input type="number" :value="bottomToolbarOffset" min="0" max="60"
                class="w-14 h-6 border border-[#c8c5ca] rounded px-1 text-[11px] text-center focus:outline-none focus:border-[#000000]"
                @input="emit('update:bottomToolbarOffset', Number(($event.target as HTMLInputElement).value))" />
              <span class="text-[11px] text-[#78767b]">{{ bottomToolbarOffset }}px</span>
            </div>
          </div>
        </section>

      </template>

      <!-- ======================== Tab 2: 主题样式 ======================== -->
      <template v-if="activeTab === 'theme'">
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">预设配色</span>
          </div>
          <div :class="sectionBodySpace">
            <div class="flex gap-1">
              <button v-for="preset in themePresets" :key="preset.name"
                :class="[btnBase, 'flex-1 text-center', themePreset === preset.name && btnActive]"
                :title="preset.label + '(' + preset.color + ')'"
                @click="emit('applyThemePreset', preset.name)">
                {{ preset.label }}
              </button>
            </div>
          </div>
        </section>

        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">自定义配色</span>
          </div>
          <div :class="sectionBodySpace">
            <div :class="rowItem">
              <span class="text-[11px] font-medium text-[#1a1c1d] w-10 shrink-0">主色</span>
              <div class="w-10 h-5 rounded border border-[#c8c5ca] shrink-0"
                :style="{ background: themeAccent || '#111827' }"
                :title="themeAccent || '#111827'" />
              <input type="color" :value="themeAccent || '#111827'"
                class="w-5 h-5 border-0 p-0 cursor-pointer rounded shrink-0"
                @input="emit('applyCustomTheme', ($event.target as HTMLInputElement).value)" />
              <span class="text-[10px] text-[#78767b] font-mono truncate">{{ themeAccent || '#111827' }}</span>
            </div>
            <div :class="rowItem" v-if="themeSurface">
              <span class="text-[11px] font-medium text-[#1a1c1d] w-10 shrink-0">底色</span>
              <div class="w-10 h-5 rounded border border-[#c8c5ca] shrink-0"
                :style="{ background: themeSurface }"
                :title="themeSurface" />
              <span class="text-[10px] text-[#78767b] font-mono truncate">{{ themeSurface }}</span>
            </div>
          </div>
        </section>
      </template>

      <!-- ======================== Tab 3: 存储配置 ======================== -->
      <template v-if="activeTab === 'storage'">
        <!-- 连接状态 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">连接状态</span>
          </div>
          <div :class="sectionBody">
            <div :class="rowItem">
              <span class="text-[11px] font-medium text-[#1a1c1d] w-14 shrink-0">模式</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full"
                :class="statusBadgeClass(storage?.mode || 'none')">
                {{ modeLabelText[storage?.mode || 'none'] || storage?.mode }}
              </span>
            </div>
            <div :class="rowItem" v-if="storage?.workspaceName">
              <span class="text-[11px] font-medium text-[#1a1c1d] w-14 shrink-0">工作区</span>
              <span class="text-[11px] text-[#47464a] truncate font-mono">{{ storage.workspaceName }}</span>
            </div>
            <div :class="rowItem">
              <span class="text-[11px] font-medium text-[#1a1c1d] w-14 shrink-0">项目数</span>
              <span class="text-[11px] text-[#47464a]">{{ storage?.projectCount ?? 0 }}</span>
            </div>
            <div class="flex gap-1.5 pt-1">
              <button :class="[btnBase, 'flex-1 text-center']"
                :disabled="storage?.mode === 'filesystem'"
                @click="emit('storageConnect')">
                连接文件夹
              </button>
              <button :class="[btnBase, 'flex-1 text-center']"
                :disabled="storage?.mode !== 'filesystem'"
                @click="emit('storageDisconnect')">
                断开
              </button>
            </div>
          </div>
        </section>

        <!-- 项目列表 -->
        <section :class="sectionCard">
          <div :class="sectionHeader">
            <span :class="sectionTitle">项目</span>
          </div>
          <div :class="sectionBodySpace">
            <!-- 项目列表 -->
            <div v-if="storageProjects.length > 0" class="flex flex-col gap-1">
              <div v-for="proj in storageProjects" :key="proj.id"
                class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors border"
                :class="storage?.currentProjectId === proj.id
                  ? 'bg-[#000000]/5 border-[#000000]/20 text-[#1a1c1d]'
                  : 'bg-[#f9f9fa] border-transparent hover:bg-[#f3f3f4] text-[#47464a]'"
                @click="emit('storageSwitchProject', proj.id)">
                <span class="text-[11px] flex-1 truncate font-medium">{{ proj.name }}</span>
                <span v-if="storage?.currentProjectId === proj.id"
                  class="text-[9px] text-[#47464a] bg-[#e8e8e9] px-1.5 py-0.5 rounded-full">当前</span>
                <button v-if="storageProjects.length > 1"
                  class="w-4 h-4 flex items-center justify-center rounded text-[#78767b] hover:text-[#ba1a1a] hover:bg-[#ba1a1a]/10 shrink-0 text-[10px] leading-none"
                  title="删除项目"
                  @click.stop="emit('storageDeleteProject', proj.id)">×</button>
              </div>
            </div>
            <div v-else class="text-[11px] text-[#78767b] italic px-2">暂无项目</div>

            <!-- 新建项目 -->
            <div class="pt-2 border-t border-[#c8c5ca]/40">
              <template v-if="showNewProjectInput">
                <div class="flex gap-1">
                  <input v-model="newProjectName"
                    class="flex-1 h-6 border border-[#c8c5ca] rounded px-2 text-[11px] focus:outline-none focus:border-[#000000]"
                    placeholder="项目名称"
                    @keyup.enter="onAddProject" />
                  <button :class="[btnBase, btnActive]"
                    @click="onAddProject">确定</button>
                  <button :class="btnBase"
                    @click="showNewProjectInput = false; newProjectName = ''">取消</button>
                </div>
              </template>
              <button v-else :class="[btnBase, 'w-full text-center']"
                @click="showNewProjectInput = true">
                + 新建项目
              </button>
            </div>
          </div>
        </section>
      </template>

    </div>
  </div>
</template>
