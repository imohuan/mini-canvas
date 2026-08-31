<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { computed, ref, watch, nextTick } from 'vue'
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { AxSelect, AxButton } from '../../components/Ui'
import { useTeleportTarget } from '../../components/Ui/hooks/useTeleportTarget'
import type { SelectOption } from '../../components/Ui'
import { useUpstreamResources } from '../../composables/useUpstreamResources'

export interface ToolbarConfig {
  promptText: string
  promptDoc?: any
  selectedStyle: string
  selectedModel: string
  selectedSize: string
}

interface Props extends NodeProps {
  isFullscreen?: boolean
}

const props = withDefaults(defineProps<Props>(), { isFullscreen: false })

const config = defineModel<ToolbarConfig>({ required: true })

const emit = defineEmits<{
  (e: 'action', action: string, value?: string): void
}>()

// ── 连接的上游节点资源（图片 + 文本）→ 素材资源 ──

const teleportTarget = useTeleportTarget()

const upstreamResources = useUpstreamResources(props.id as string | null)

const connectedImages = computed<ResourceItem[]>(() =>
  upstreamResources.value.map((res, i) => {
    const base = {
      id: `connected-${i}`,
      name: res.name || `素材${i + 1}`,
      category: '素材',
    }

    // 文本类资源：无 url，走 editor 的文本资源分支（@name + data-value）
    if (res.kind === 'text') {
      const item: ResourceItem = {
        ...base,
        value: res.value,
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>`,
        renderEditor: (self) => {
          return [
            "span",
            {
              class: "resource-node resource-node-text",
              "data-id": self.id,
              "data-name": self.name,
              "data-value": self.value || "",
              "data-category": self.category,
            },
            ["span", { class: "label" }, `@${self.name}`],
          ]
        },
      }
      return item
    }

    // 图片类资源：缩略图 + 点击预览
    const img = { url: res.url, name: res.name }
    const item: ResourceItem = {
      ...base,
      url: res.url,
      mediaType: 'image',
      renderEditor: (self) => {
        return [
          "span",
          {
            class: "resource-node",
            "data-id": self.id,
            "data-url": self.url || "",
            "data-name": self.name,
            "data-category": self.category,
            style: "display: inline-flex; align-items: center; gap: 4px; vertical-align: bottom",
          },
          ["img", { src: self.url || "", draggable: "false", style: "width: 16px; height: 16px; border-radius: 2px; object-fit: cover; pointer-events: none" }],
        ]
      },
      onClick: () => {
        const viewer = document.createElement('div')
        viewer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer'
        const imgEl = document.createElement('img')
        imgEl.src = img.url; imgEl.style.maxWidth = '90vw'; imgEl.style.maxHeight = '90vh'; imgEl.style.objectFit = 'contain'
        viewer.appendChild(imgEl)
        viewer.onclick = () => viewer.remove()
        document.body.appendChild(viewer)
      },
    }
    return item
  })
)

/** 根据名称查找素材，用于纯文本 @name 反序列化回 resource node */
function resolveResource(name: string): ResourceItem | null {
  return connectedImages.value.find(item => item.name === name) || null
}

/** mention-menu 定位：从 DOM selection 获取实际光标位置，修正 ProseMirror coordsAtPos 在 transform 容器下的偏差 */
function getMentionMenuStyle(vpPos: { left: string; top: string; origin?: string }) {
  const fallback = { left: vpPos.left, top: vpPos.top, transformOrigin: vpPos.origin || 'top left' }
  const editorEl = inputAreaRef.value?.querySelector('.ProseMirror') as HTMLElement | null
  if (!editorEl) return fallback

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return fallback
  if (!editorEl.contains(sel.anchorNode)) return fallback

  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(true)
  // 用 getBoundingClientRect 而非 getClientRects()[0]：零宽光标（行末/空行）getClientRects
  // 返回的 width=0，但 getBoundingClientRect 仍返回有效位置。避免触发 fallback 走 vpPos
  // （vpPos 来自 ProseMirror coordsAtPos，在外层 transform 缩放下会失真）。
  const rect = range.getBoundingClientRect()
  if (!rect) return fallback

  // 边界检测（同 useEditor.ts showMenu 逻辑）
  const menuWidth = 200
  // 用实际渲染高度做翻转判定：资源项少时菜单很矮，用固定 280 会误判「放不下」而错误翻到上方
  const menuMaxHeight = menuActualHeight.value
  const gap = 8
  const minMargin = 8

  let left = rect.left
  let top = rect.bottom + gap

  if (left + menuWidth > window.innerWidth) left = rect.right - menuWidth
  if (top + menuMaxHeight > window.innerHeight) top = rect.top - menuMaxHeight - gap

  return {
    left: `${Math.max(minMargin, left)}px`,
    top: `${Math.max(minMargin, top)}px`,
    transformOrigin: vpPos.origin || 'top left',
  }
}

/** 计算 ResourceItem 在分组中的全局索引 */
function getItemGlobalIndex(
  item: ResourceItem,
  groupedItems: Map<string, ResourceItem[]>,
  categoryOrder: string[],
): number {
  let count = 0
  for (const cat of categoryOrder) {
    const catItems = groupedItems.get(cat)
    if (!catItems) continue
    const idx = catItems.indexOf(item)
    if (idx !== -1) return count + idx
    count += catItems.length
  }
  return -1
}

// ── 下拉选项 ──

const STYLE_OPTIONS: SelectOption[] = [
  { label: '美式复古好莱坞', value: 'hollywood-retro' },
  { label: '赛博朋克', value: 'cyberpunk' },
  { label: '水墨画风', value: 'ink-wash' },
  { label: '3D 渲染', value: '3d-render' },
  { label: '日系动漫', value: 'anime' },
  { label: '油画质感', value: 'oil-painting' },
]

const MODEL_OPTIONS: SelectOption[] = [
  { label: '小云雀 AnyCook', value: 'anycook' },
  { label: 'Stable Diffusion XL', value: 'sdxl' },
  { label: 'Midjourney v6', value: 'mj6' },
  { label: 'DALL·E 3', value: 'dalle3' },
  { label: 'Flux.1 Pro', value: 'flux-pro' },
]

const SIZE_OPTIONS: SelectOption[] = [
  { label: '9:16 · 3K', value: '9:16-3k' },
  { label: '16:9 · 4K', value: '16:9-4k' },
  { label: '1:1 · 2K', value: '1:1-2k' },
  { label: '4:3 · 2K', value: '4:3-2k' },
  { label: '3:2 · 3K', value: '3:2-3k' },
  { label: '21:9 · 5K', value: '21:9-5k' },
]

// ── v-model 双向绑定字段 ──

const promptText = computed({
  get: () => config.value.promptText,
  set: (val: string) => { config.value = { ...config.value, promptText: val } },
})

const promptDoc = computed({
  get: () => config.value.promptDoc,
  set: (val: any) => { config.value = { ...config.value, promptDoc: val } },
})

const selectedStyle = computed({
  get: () => config.value.selectedStyle,
  set: (val: string) => { config.value = { ...config.value, selectedStyle: val } },
})

const selectedModel = computed({
  get: () => config.value.selectedModel,
  set: (val: string) => { config.value = { ...config.value, selectedModel: val } },
})

const selectedSize = computed({
  get: () => config.value.selectedSize,
  set: (val: string) => { config.value = { ...config.value, selectedSize: val } },
})

const inputAreaRef = ref<HTMLElement | null>(null)
const editorRef = ref<InstanceType<typeof ProseMirrorEditor> | null>(null)
const mentionMenuRef = ref<HTMLElement | null>(null)

/** @ 菜单的实际渲染高度（px）。菜单显示后测量，用于翻转判定，避免用固定 280 误判翻转 */
const menuActualHeight = ref(280)

// 菜单显示后测量真实高度，更新翻转判定依据
watch(mentionMenuRef, async (el) => {
  if (el) {
    await nextTick()
    const h = el.offsetHeight
    if (h > 0) menuActualHeight.value = h
  }
})

const hasOverlay = computed(() => !!props.data?._overlay)

// ── 事件 ──

function onInput() {
  emit('action', 'input', promptText.value)
}

function onAdd() {
  emit('action', 'add')
}

function onSettings() {
  emit('action', 'settings')
}

function onMore() {
  emit('action', 'more')
}

function onInputAreaClick() {
  editorRef.value?.focusEnd()
}

function onAi() {
  emit('action', 'ai', promptText.value)
}

/** 拦截 Delete/Backspace 键，防止 VueFlow 删除当前节点 */
function onEditorKeydown(e: KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.stopPropagation()
  }
}
</script>

<template>
  <div v-if="!hasOverlay" class="image-bottom-panel">
    <!-- 输入区域 — ProseMirrorEditor -->
    <div ref="inputAreaRef" class="input-area" @click="onInputAreaClick">
      <div class="editor-wrapper" @keydown="onEditorKeydown">
        <ProseMirrorEditor ref="editorRef" v-model="promptText" v-model:prompt-doc="promptDoc" :resources="connectedImages" :resolve-resource="resolveResource" placeholder="描述你想要生成的画面内容，@引用素材"
          @update:model-value="onInput" @click.stop>
          <template #mention-menu="{ visible, groupedItems, categoryOrder, position, activeIndex, onSelect }">
            <Teleport :to="teleportTarget">
              <Transition name="ax-fade-scale">
                <div v-if="visible" ref="mentionMenuRef" class="mention-menu-dropdown" :style="getMentionMenuStyle(position)">
                  <template v-for="category in categoryOrder" :key="category">
                    <div v-if="groupedItems.has(category) && groupedItems.get(category)!.length > 0">
                      <div class="mention-menu-category">{{ category }}</div>
                      <div v-for="item in groupedItems.get(category)!" :key="item.id"
                        class="mention-menu-item"
                        :class="{ active: getItemGlobalIndex(item, groupedItems, categoryOrder) === activeIndex }"
                        @mousedown.prevent="onSelect(item)">
                        <img v-if="item.url" :src="item.url" class="mention-menu-thumb" draggable="false" />
                        <span v-else-if="item.icon" v-html="item.icon" class="mention-menu-icon" />
                        <span class="mention-menu-name">{{ item.name }}</span>
                      </div>
                    </div>
                  </template>
                </div>
              </Transition>
            </Teleport>
          </template>
        </ProseMirrorEditor>
      </div>
      <button class="expand-btn" :title="props.isFullscreen ? '退出全屏' : '全屏显示'" @click="onMore">
        <!-- 全屏 → 缩小图标 -->
        <svg v-if="props.isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="21 9 21 3 15 3" />
          <polyline points="3 15 3 21 9 21" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
        <!-- 非全屏 → 放大图标 -->
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>

    <!-- 底部工具栏 -->
    <div class="toolbar-row">
      <!-- 左侧 -->
      <div class="toolbar-left">
        <AxButton variant="ghost" size="icon" icon="add" title="添加" @click="onAdd" />

        <AxButton variant="ghost" size="icon" icon="settings" title="设置" @click="onSettings" />

        <div class="toolbar-divider" />

        <AxSelect v-model="selectedStyle" :options="STYLE_OPTIONS" size="sm" placeholder="选择风格" trigger-width="110px" />

        <AxSelect v-model="selectedModel" :options="MODEL_OPTIONS" size="sm" placeholder="选择模型" trigger-width="130px" />

        <AxSelect v-model="selectedSize" :options="SIZE_OPTIONS" size="sm" placeholder="选择尺寸" trigger-width="95px" />
      </div>

      <!-- 右侧 -->
      <div class="toolbar-right">
        <AxButton variant="ghost" size="icon" icon="add_circle" title="更多" @click="onMore" />

        <button class="btn-ai" @click="onAi">
          <svg class="ai-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span class="ai-badge">1</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-bottom-panel {
  width: 650px;
  background: rgba(245, 245, 245, 0.98);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(12px);
  overflow: visible;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  position: relative;
  height: 200px;
}

/* ── 输入区域 ── */

.input-area {
  padding: 10px 14px 4px;
  flex: 1;
  width: 100%;
  overflow: hidden;
}

.editor-wrapper {
  width: 100%;
  height: 100%;
  padding-right: 24px;
  overflow-y: auto;
  overflow-x: hidden;
  /* Firefox: thin scrollbar, transparent track, colored thumb */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
}

/* Webkit 滚动条 (Chrome, Safari, Edge) — 只有色块 */
.editor-wrapper::-webkit-scrollbar {
  width: 5px;
}
.editor-wrapper::-webkit-scrollbar-track {
  background: transparent;
}
.editor-wrapper::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.18);
  border-radius: 3px;
}
.editor-wrapper::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

/* 覆盖 ProseMirror 默认高度 */
.editor-wrapper :deep(.prose-mirror-editor > div:first-child) {
  min-height: 48px !important;
}

.editor-wrapper :deep(.ProseMirror) {
  min-height: 48px !important;
  font-size: 14px;
  line-height: 1.6;
  color: #1a1a1a;
  outline: none !important;
}

.editor-wrapper :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  color: #9ca3af;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

/* ── mention-menu 下拉框 ── */

.mention-menu-dropdown {
  position: fixed;
  z-index: 99999;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  min-width: 180px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.mention-menu-category {
  padding: 6px 10px 2px;
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
}

.mention-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 14px;
  border-radius: 6px;
  color: #374151;
  background: transparent;
  transition: background 0.1s ease;
}

.mention-menu-item.active {
  background: #eff6ff;
  color: #2b6df2;
}

.mention-menu-item:hover:not(.active) {
  background: rgba(0, 0, 0, 0.04);
}

.mention-menu-thumb {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.mention-menu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ax-fade-scale-enter-active {
  transition: opacity .15s ease, transform .15s ease;
}

.ax-fade-scale-leave-active {
  transition: opacity .1s ease, transform .1s ease;
}

.ax-fade-scale-enter-from {
  opacity: 0;
  transform: scale(.95);
}

.ax-fade-scale-leave-to {
  opacity: 0;
  transform: scale(.95);
}


.editor-wrapper :deep(.prose-mirror-editor) {
  width: 100%;
}

.expand-btn {
  position: absolute;
  right: 12px;
  top: 10px;
  width: 20px;
  height: 20px;
  padding: 2px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.expand-btn:hover {
  opacity: 1;
}

.expand-btn svg {
  width: 16px;
  height: 16px;
}

/* ── 工具栏 ── */

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 10px;
  gap: 6px;
  width: 100%;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(0, 0, 0, 0.08);
  margin: 0 2px;
  flex-shrink: 0;
}

/* ── AxSelect 样式微调 ── */

.toolbar-left :deep(.ax-select-trigger) {
  flex-shrink: 0;
}

/* ── AI 按钮 ── */

.btn-ai {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px 6px 8px;
  border: none;
  border-radius: 14px;
  background: rgba(124, 58, 237, 0.08);
  color: #7c3aed;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-ai:hover {
  background: rgba(124, 58, 237, 0.15);
}

.ai-icon {
  width: 14px;
  height: 14px;
}

.ai-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #7c3aed;
  color: white;
  font-size: 10px;
  font-weight: 600;
  border-radius: 8px;
}
</style>
