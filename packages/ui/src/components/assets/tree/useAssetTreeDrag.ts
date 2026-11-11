import { ref } from 'vue'
import type { AssetTreeRow } from './types'

/**
 * 资产树的行拖拽会话：只影响视觉与 drop 派发。
 * 保持原组件里的执行顺序与判定规则不变。
 */
export function useAssetTreeDrag(
  props: { rows: AssetTreeRow[]; batchOn: boolean; renamingId: string | null },
  emit: (event: 'dropOn', payload: { from: AssetTreeRow; to: AssetTreeRow | null }) => void,
) {
  const draggingId = ref<string | null>(null)
  const draggingKind = ref<'folder' | 'asset' | null>(null)
  /** 当前悬停的目标行 id（高亮用） */
  const dragOverId = ref<string | null>(null)

  function startDrag(row: AssetTreeRow, e: DragEvent): void {
    if (props.batchOn || props.renamingId === row.id) { e.preventDefault(); return }
    draggingId.value = row.id
    draggingKind.value = row.kind
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', row.id)
      // 资产：额外带一条「这是从资源树拖出去的资产」的标记。
      // 画布侧的 file-drop 插件只认拖进来的**文件**；资源树里的资产是"已经在服务器上的引用"，
      // 拖到画布该建节点、而不是再上传一份，所以由宿主（抽屉/弹窗）自己接 drop（见 onCanvasDrop）。
      if (row.kind === 'asset') {
        try {
          e.dataTransfer.setData('application/x-plume-asset', JSON.stringify({ id: row.id }))
        } catch {
          /* 某些环境不允许自定义 MIME：宿主仍能靠 text/plain 的 id 兜底 */
        }
      }
    }
  }

  /**
   * 这一行能不能接住当前拖拽物。
   * 规则：只有文件夹能收；不能拖到自己身上；文件夹也不能拖进「自己的子孙」——
   * 后台会拒绝成环，但**悬停时就不该高亮**（高亮了却落不下去 = 用户报过的"看着能放、放了没反应"）。
   */
  function canDropOn(row: AssetTreeRow): boolean {
    const from = draggingId.value
    if (!from) return false
    if (row.kind !== 'folder') return false
    if (row.id === from) return false
    if (draggingKind.value === 'folder') {
      // 拖到「自己当前的父级」= 原地不动，不提示
      if ((row.id === draggingParentOf(from))) return false
      // 拖到自己的子孙里 = 成环，不提示
      if (isDescendant(row.id, from)) return false
    } else if (draggingKind.value === 'asset') {
      // 资产已经在目标文件夹里 = 原地不动，不提示
      if (draggingParentOf(from) === row.id) return false
    }
    return true
  }

  /** 某行当前所在的文件夹 id（文件夹与资产都用 parentId；资产老字段 folderId 已在宿主侧归一到 parentId） */
  function draggingParentOf(id: string): string | undefined {
    return props.rows.find((r) => r.id === id)?.parentId
  }
  /** 顺着 folderId/parentId 往上找，targetAncestorId 是不是 id 的祖先（或等于它） */
  function isDescendant(id: string, targetAncestorId: string): boolean {
    const folders = props.rows.filter((r) => r.kind === 'folder')
    let cur: string | undefined = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (cur === targetAncestorId) return true
      seen.add(cur)
      cur = folders.find((f) => f.id === cur)?.parentId
    }
    return false
  }

  function onDragOver(row: AssetTreeRow, e: DragEvent): void {
    if (!canDropOn(row)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dragOverId.value = row.id
  }
  function onDragLeave(row: AssetTreeRow): void {
    if (dragOverId.value === row.id) dragOverId.value = null
  }
  function onDrop(row: AssetTreeRow, e: DragEvent): void {
    if (!canDropOn(row)) return
    e.preventDefault()
    const from = props.rows.find((r) => r.id === draggingId.value)
    endDrag()
    if (from) emit('dropOn', { from, to: row })
  }
  /**
   * 拖到列表空白 = **取消本次拖拽**（不再当作“移到根目录”）。
   *
   * 审查发现的误触（用户容易丢东西）：只有落在**文件夹行**上才算“移进去”；拖到行与行的空隙、
   * 资产行、或任何非目标行上松手，以前会被容器的 drop 冒泡接住、按“拖到根目录”处理 ——
   * 嵌套的文件夹/资产会被**静默移到根**，没有任何提示，用户以为东西丢了。
   *
   * 现在语义收紧：只有显式拖到某个文件夹行上才移动；拖到别处一律原地不动。
   * “移回根目录”仍保留入口 —— 行菜单里的「移动到 →（根目录）个人资产库」。
   */
  function onDropRoot(): void {
    endDrag()
  }

  function onDragEnd(): void {
    endDrag()
  }
  function endDrag(): void {
    draggingId.value = null
    draggingKind.value = null
    dragOverId.value = null
  }

  return {
    draggingId,
    dragOverId,
    startDrag,
    onDragOver,
    onDragLeave,
    onDrop,
    onDropRoot,
    onDragEnd,
  }
}
