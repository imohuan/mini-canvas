<script setup lang="ts">
/**
 * ShortcutHelpPanel —— 快捷键帮助面板（v2 复刻老版 shortcut-manager ShortcutHelpPanel.vue）。
 *
 * 功能与原版一致：
 * - 分组帮助列表（系统/编辑/画布/视图/插件）；每行：图标 + 命令名 + hover 描述 + 键帽 + 重映射入口；
 * - 系统/浏览器保留键黄色 ⚠ 软提醒；行内展开 RemapPanel 单条重映射；
 * - 头部：导出配置 / 导入配置 / 恢复默认 / 关闭；
 * - 搜索（命令/键位/ID）+ 无结果提示 + 顶部冲突计数徽章。
 *
 * 数据源差异（v2）：老版读 ShortcutManager 单例；v2 经 ctx.get('shortcut-manager') 适配器，
 * 从命令注册表 keys（宿主统一分发的唯一数据源）现算帮助列表/冲突/重映射，逻辑零 Vue 可单测。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import type { V2ShortcutHelpItem, V2ShortcutManager } from './v2ShortcutManager'
import RemapPanel from './RemapPanel.vue'
import ShortcutKeys from './ShortcutKeys.vue'
import { normalizeKeyForPlatform } from './keyLabels'

const emit = defineEmits<{ close: [] }>()

const { ctx } = useCanvasRender()
const manager = ctx.get<V2ShortcutManager>('shortcut-manager')
const service = ctx.get<{ visible: boolean }>('shortcut-manager')

const searchQuery = ref('')
const conflicts = ref(manager?.getConflicts() ?? [])
const helpList = ref(manager?.getHelpList() ?? [])
/** 当前正在展开"重映射"面板的行 ID（null = 全部收起） */
const remappingId = ref<string | null>(null)

const groupLabels: Record<string, string> = {
  system: '系统',
  edit: '编辑',
  canvas: '画布',
  view: '视图',
  plugin: '插件',
}

/** 分组名（v2ShortcutManager.groupV2HelpList 输出 group 为英文 key） */
type V2Group = 'system' | 'edit' | 'canvas' | 'view' | 'plugin'

/**
 * 系统/浏览器强保留键集合。
 * 这些键通常由操作系统或浏览器原生占用（标签页管理、查找、打印、窗口导航等），
 * 页面里的 JS 大多拦不住或会与原生行为并存。把画布快捷键绑到这些键上会跟系统冲突，
 * 因此在这些条目旁显示黄色软提醒。格式为已规范化的小写、无空格键位串。
 */
const SYSTEM_RESERVED_KEYS = new Set<string>([
  'ctrl+t', 'ctrl+w', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+tab', 'ctrl+shift+tab',
  'ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9',
  'ctrl+n', 'ctrl+shift+n', 'ctrl+f', 'ctrl+p', 'ctrl+s', 'ctrl+shift+s',
  'ctrl+l', 'ctrl+r', 'ctrl+shift+r',
])

/** 判断一个快捷键键位是否命中了系统/浏览器强保留键（mod 先按平台归一，mac 上等价 meta 组合也命中） */
function isSystemReservedKey(keys: string): boolean {
  if (!keys) return false
  return SYSTEM_RESERVED_KEYS.has(normalizeKeyForPlatform(keys))
}

/** 内置快捷键的副标题 — 与右键菜单的 description 文案风格一致 */
const commandDescriptions: Record<string, string> = {
  '快捷键帮助': '查看与重映射所有快捷键',
  '撤销': '回退最近一次操作',
  '重做': '恢复被撤销的操作',
  '删除选中': '移除当前选中的节点或连线',
  '复制选中': '复制当前选中的节点',
  '粘贴': '在画布粘贴剪贴板内容',
  '剪切': '剪切当前选中的节点',
  '全选': '选中画布上所有节点',
  '保存': '保存当前画布快照',
  '适应屏幕': '将画布缩放到适应视口',
  '放大': '放大画布视图',
  '缩小': '缩小画布视图',
  '重置缩放': '将画布缩放重置为 100%',
  '切换辅助线': '显示或隐藏对齐辅助线',
  '切换网格': '显示或隐藏网格背景',
  '切换小地图': '显示或隐藏画布缩略图',
  '搜索节点': '按名称/类型查找并聚焦节点',
  '自动布局': '对画布应用自动布局',
  '适应视图': '将视口缩放到适应全部内容',
  '聚焦选中节点': '缩放聚焦到当前选中的节点',
  '对齐辅助线': '拖动时显示对齐参考线',
  '复制一份选中节点': '原位复制当前选中的节点',
  '删除节点': '移除该节点',
  '删除连线': '移除该连线',
}

interface DecoratedItem extends V2ShortcutHelpItem {
  description: string
  systemReserved: boolean
}

const filteredHelpList = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  const mapGroups = helpList.value.map((g) => ({
    ...g,
    items: g.items.map((it) => decorateItem(it)),
  }))
  if (!q) return mapGroups
  // mod 归一成 ctrl 后再匹配一次：用户搜 'ctrl+z' 能命中 'mod+z'
  const normQ = normalizeKeyForPlatform(q)
  return mapGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          i.command.toLowerCase().includes(q) ||
          i.keys.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          (normQ.length > 0 && normalizeKeyForPlatform(i.keys).includes(normQ)),
      ),
    }))
    .filter((g) => g.items.length > 0)
})

/** 给一条快捷键项补上 description + 系统保留标记 */
function decorateItem(it: V2ShortcutHelpItem): DecoratedItem {
  return {
    ...it,
    description: commandDescriptions[it.command] || '',
    systemReserved: isSystemReservedKey(it.keys),
  }
}

function shortcutIcon(keys: string): string {
  const k = keys.toLowerCase()
  if (k === 'delete' || k === 'backspace') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
  }
  if (k.includes('+z')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'
  }
  if (k.includes('+y')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>'
  }
  if (k.includes('+c') || k === 'c') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
  }
  if (k.includes('+v') || k === 'v') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>'
  }
  if (k.includes('+x') || k === 'x') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M9 18l6-12"/></svg>'
  }
  if (k.includes('+a') || k === 'a') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h6v12H3z"/><path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/></svg>'
  }
  if (k.includes('+s') || k === 's') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h12l3 3v15a0 0 0 0 1 0 0H5z"/><path d="M8 7h6"/><path d="M8 11h6"/></svg>'
  }
  if (k.includes('+0')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
  }
  if (k === '=' || k === '+' || k.includes('+=')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M11 8v6"/><path d="M8 11h6"/><path d="M21 21l-4.3-4.3"/></svg>'
  }
  if (k === '-' || k.includes('+-')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6"/><path d="M21 21l-4.3-4.3"/></svg>'
  }
  if (k === 'f') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V4h4"/><path d="M21 8V4h-4"/><path d="M3 16v4h4"/><path d="M21 16v4h-4"/></svg>'
  }
  if (k.includes('+')) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 10h.01"/><path d="M16 14h.01"/></svg>'
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/></svg>'
}

function onSelectRow(item: DecoratedItem) {
  remappingId.value = remappingId.value === item.id ? null : item.id
}

function openRemap(item: DecoratedItem) {
  remappingId.value = item.id
}

function closeRemap() {
  refreshData()
  remappingId.value = null
}

function refreshData() {
  if (!manager) return
  helpList.value = manager.getHelpList()
  conflicts.value = manager.getConflicts()
}

function resetDefaults() {
  manager?.resetDefaults()
  refreshData()
}

function exportKeymap() {
  if (!manager) return
  const data = manager.exportKeymap()
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shortcut-keymap.json'
  a.click()
  URL.revokeObjectURL(url)
}

function importKeymap() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        manager?.loadKeymap(data)
        refreshData()
      } catch {
        alert('导入失败：JSON 格式无效')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

function close(): void {
  if (service) service.visible = false
  emit('close')
}

// Escape 关闭
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="service && service.visible" class="shortcut-help-layer" @pointerdown.self="close" @contextmenu.prevent>
      <div class="shortcut-help-panel" @pointerdown.stop>
        <div class="shortcut-help-header">
          <div class="shortcut-help-title-block">
            <span class="shortcut-help-eyebrow">键盘</span>
            <h2 class="shortcut-help-title">快捷键参考</h2>
          </div>
          <div class="shortcut-help-header-actions">
            <button class="shortcut-help-icon-btn" title="导出配置" @click="exportKeymap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
              </svg>
            </button>
            <button class="shortcut-help-icon-btn" title="导入配置" @click="importKeymap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>
              </svg>
            </button>
            <button class="shortcut-help-icon-btn" title="恢复默认" @click="resetDefaults">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
              </svg>
            </button>
            <button class="shortcut-help-icon-btn close-btn" title="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="shortcut-help-search">
          <span class="search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
          </span>
          <input
            v-model="searchQuery"
            placeholder="搜索命令、键位或 ID..."
            class="search-input"
            autofocus
          />
          <span v-if="conflicts.length > 0" class="conflict-warning">
            ⚠ {{ conflicts.length }} 个冲突
          </span>
        </div>

        <div class="shortcut-help-list">
          <div v-if="filteredHelpList.length === 0" class="no-results">无匹配结果</div>

          <template v-for="(group, gIdx) in filteredHelpList" :key="group.group">
            <div v-if="gIdx > 0" class="canvas-menu-divider" />
            <div class="shortcut-group">
              <h3 class="group-title">{{ groupLabels[group.group as V2Group] || group.group }}</h3>
              <template v-for="(item, iIdx) in group.items" :key="item.id">
                <div
                  class="canvas-menu-item shortcut-row"
                  :class="{ hasDescription: item.description, 'is-remapping-open': remappingId === item.id }"
                  role="button"
                  tabindex="0"
                  :style="{ '--item-index': iIdx }"
                  @click="onSelectRow(item)"
                >
                  <div class="remap-head">
                    <span class="canvas-menu-icon" v-html="shortcutIcon(item.keys)" />
                    <span class="canvas-menu-copy">
                      <span class="canvas-menu-label">{{ item.command }}</span>
                      <span v-if="item.description" class="canvas-menu-description">{{ item.description }}</span>
                    </span>
                    <ShortcutKeys :keys="item.keys" :id-prefix="`row-${item.id}`" />
                    <span
                      v-if="item.systemReserved"
                      class="canvas-menu-badge sys-reserved-badge"
                      title="该键位与系统/浏览器快捷键冲突（如 ctrl+f 会同时触发浏览器查找），按此键可能无效或触发原生行为"
                    >⚠ 系统冲突</span>
                    <button
                      class="canvas-menu-badge remap-badge"
                      :class="{ 'is-open': remappingId === item.id }"
                      @click.stop="openRemap(item)"
                      type="button"
                    >
                      {{ remappingId === item.id ? '收起' : '重映射' }}
                    </button>
                  </div>

                  <div v-if="remappingId === item.id" class="remap-slot" @click.stop>
                    <RemapPanel :item="item" @close="closeRemap" />
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============ 外层：与 CanvasMenu 同样的浮层策略 ============ */
.shortcut-help-layer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.shortcut-help-panel {
  position: relative;
  width: min(640px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  color: #374151;
  animation: menu-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ============ 顶部 ============ */
.shortcut-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px 10px;
}

.shortcut-help-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}

.shortcut-help-eyebrow {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.shortcut-help-title {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.shortcut-help-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.shortcut-help-icon-btn {
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
.shortcut-help-icon-btn :deep(svg) {
  width: 16px;
  height: 16px;
}
.shortcut-help-icon-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #111827;
}
.shortcut-help-icon-btn.close-btn:hover {
  color: #ef4444;
}

/* ============ 搜索条 ============ */
.shortcut-help-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  margin: 4px 4px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  transition: background 0.18s ease;
}
.shortcut-help-search:focus-within {
  background: rgba(0, 0, 0, 0.06);
}
.search-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
}
.search-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
.search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #111827;
  font-size: 13px;
  font-weight: 500;
}
.search-input::placeholder {
  color: #9ca3af;
}
.conflict-warning {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
}

/* ============ 列表 ============ */
.shortcut-help-list {
  flex: 1;
  min-height: 0;
  padding: 0 4px 4px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.shortcut-group {
  margin-top: 4px;
}

.group-title {
  margin: 4px 6px 4px;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 700;
}

.canvas-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.06);
}

.canvas-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.24s ease;
  animation: menu-item-in 0.2s ease both;
  animation-delay: calc(var(--item-index, 0) * 18ms);
}

.canvas-menu-item.is-remapping-open {
  flex-direction: column;
  align-items: stretch;
  height: auto;
  gap: 0;
  padding: 6px;
  background: rgba(8, 145, 178, 0.1);
  overflow: hidden;
  border-radius: 12px;
}

.remap-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
}

.remap-head {
  outline: none;
}
.remap-head:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -1px;
  border-radius: 8px;
}

.is-remapping-open .remap-head {
  cursor: pointer;
}

.is-remapping-open .remap-head .canvas-menu-description {
  display: none;
}
.is-remapping-open .remap-head .canvas-menu-label {
  top: 50%;
  transform: translateY(-50%);
  transition: none;
}

.canvas-menu-item:hover:not(.is-disabled) {
  background: rgba(0, 0, 0, 0.05);
}

.canvas-menu-item.is-remapping-open:hover {
  background: rgba(8, 145, 178, 0.1);
}

.canvas-menu-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.canvas-menu-item.is-danger {
  color: #ef4444;
}

.canvas-menu-item.is-danger:hover:not(.is-disabled) {
  background: rgba(239, 68, 68, 0.1);
}

.canvas-menu-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #6b7280;
  background: rgba(0, 0, 0, 0.04);
}
.canvas-menu-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.canvas-menu-copy {
  min-width: 0;
  flex: 1;
  align-self: stretch;
  position: relative;
  overflow: hidden;
  min-height: 34px;
}

.canvas-menu-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  display: block;
  position: absolute;
  top: 50%;
  left: 0;
  color: #111827;
  transform: translateY(-50%);
}

.hasDescription .canvas-menu-label {
  transition: top 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .canvas-menu-label,
.hasDescription:focus-within .canvas-menu-label {
  top: 3px;
  transform: translateY(0);
}

.canvas-menu-description {
  color: #9ca3af;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  position: absolute;
  bottom: 3px;
  left: 0;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}
.hasDescription:hover .canvas-menu-description,
.hasDescription:focus-within .canvas-menu-description {
  opacity: 1;
  transform: translateY(0);
}

:deep(.shortcut-keys) {
  margin-right: 4px;
}

.canvas-menu-badge {
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  color: #0891b2;
  background: rgba(8, 145, 178, 0.12);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.canvas-menu-badge:hover {
  background: rgba(8, 145, 178, 0.2);
  color: #0e7490;
}

.remap-badge {
  font-family: inherit;
}

.remap-badge.is-open {
  background: rgba(8, 145, 178, 0.22);
  color: #0e7490;
}

.sys-reserved-badge {
  flex: 0 0 auto;
  white-space: nowrap;
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
  cursor: default;
}
.sys-reserved-badge:hover {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.remap-slot {
  margin: 6px 0 0;
}

.no-results {
  text-align: center;
  color: #9ca3af;
  padding: 24px 0;
  font-size: 13px;
}

/* ============ 动画 ============ */
@keyframes menu-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes menu-item-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shortcut-help-panel,
  .canvas-menu-item,
  .canvas-menu-label,
  .canvas-menu-description,
  .remap-slot,
  .remap-expand-enter-active,
  .remap-expand-leave-active {
    animation: none !important;
    transition: none !important;
  }
  .hasDescription:hover .canvas-menu-label,
  .hasDescription:focus-within .canvas-menu-label {
    top: 3px;
    transform: translateY(0);
  }
  .hasDescription:hover .canvas-menu-description,
  .hasDescription:focus-within .canvas-menu-description {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 滚动条 */
.shortcut-help-list::-webkit-scrollbar {
  width: 8px;
}
.shortcut-help-list::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.shortcut-help-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}
</style>
