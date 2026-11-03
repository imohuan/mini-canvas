/**
 * ShortcutHelpPanel 的查询、重映射入口与导入导出动作。
 *
 * 数据源仍是同包的 shortcutHelpState；这里只保留原动作顺序，
 * 面板入口负责 Teleport、可见性和键盘监听。
 */
import { computed, ref } from 'vue'
import type { V2ShortcutHelpItem, V2ShortcutManager } from '../v2ShortcutManager'
import { shortcutHelpState } from '../shortcutState'
import { normalizeKeyForPlatform } from '../keyLabels'

const manager = shortcutHelpState as V2ShortcutManager
const service = shortcutHelpState

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
export type V2Group = 'system' | 'edit' | 'canvas' | 'view' | 'plugin'

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

export interface DecoratedItem extends V2ShortcutHelpItem {
  description: string
  systemReserved: boolean
}

/** 给一条快捷键项补上 description + 系统保留标记 */
function decorateItem(it: V2ShortcutHelpItem): DecoratedItem {
  return {
    ...it,
    description: commandDescriptions[it.command] || '',
    systemReserved: isSystemReservedKey(it.keys),
  }
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
}

export function useShortcutHelpPanel() {
  return {
    service,
    searchQuery,
    conflicts,
    remappingId,
    groupLabels,
    filteredHelpList,
    shortcutIcon,
    onSelectRow,
    openRemap,
    closeRemap,
    exportKeymap,
    importKeymap,
    resetDefaults,
    close,
  }
}
