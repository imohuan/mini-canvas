import { ref } from 'vue'
import type { AssetTreeRow } from '../tree/types'
import { useUi } from '../../../composables/ui'
import { applyRowClick } from '../../../composables/assetSelection'
import { openAssetPreviewFromAsset } from '../../../composables/assetUiBus'
import { siblingPreview } from '../../../composables/assetSiblings'
import type { ManageDialogTreeContext } from './types'

/** 资产管理弹窗里资产树的动作；状态留在入口，行为保持原样。 */
export function useAssetTreeActions(ctx: ManageDialogTreeContext) {
  const ui = useUi()
  const { rows, flatFolders, batchOn, selectedIds, selectAnchorId, renamingId, exitBatch } = ctx

  function downloadAsset(url: string, name: string): void {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  }
  function downloadFolder(id: string): void {
    for (const a of ui.assetItems.value.filter((x) => x.folderId === id)) downloadAsset(a.url, a.name)
  }

  /** 勾选：未进入批量模式时，点一下即进入批量并要求「这次点击就是选中它」。 */
  function onTreeToggleSelect(id: string, shift?: boolean): void {
    if (!batchOn.value) batchOn.value = true
    const next = applyRowClick({
      rows: rows.value,
      assets: ui.assetItems.value,
      selected: selectedIds.value,
      anchorId: selectAnchorId.value,
      id,
      shift: Boolean(shift),
    })
    selectedIds.value = next.selected
    selectAnchorId.value = next.anchorId
  }

  /** 「移动到 / 添加到」目标（排除自身所在行） */
  function dialogMoveTargets(row: AssetTreeRow): { id: string; name: string; depth: number }[] {
    return flatFolders.value.filter((x) => x.id !== row.id)
  }

  /** 点资产行：弹窗这一侧不做预览（原行为：只有多选/菜单）。 */
  function onOpenAsset(row: AssetTreeRow, e?: MouseEvent): void {
    if (batchOn.value) {
      onTreeToggleSelect(row.id, Boolean(e?.shiftKey))
      return
    }
    /* no-op：保留插槽语义 */
  }

  /** 点缩略图 → 打开全屏预览；批量模式下让位给勾选。 */
  function onOpenThumb(row: AssetTreeRow): void {
    if (batchOn.value) {
      onTreeToggleSelect(row.id, false)
      return
    }
    void openAssetPreviewFromAsset(
      { id: row.id, name: row.name, url: row.url ?? '', assetKind: row.assetKind },
      siblingPreview(rows.value, row),
    )
  }

  async function onTreeRenameCommit(payload: { kind: 'folder' | 'asset'; id: string; name: string }): Promise<void> {
    renamingId.value = null
    if (!payload.name.trim()) return
    if (payload.kind === 'folder') await ui.renameAssetFolderById(payload.id, payload.name.trim())
    else await ui.renameAssetById(payload.id, payload.name.trim())
  }

  function onTreeAddAgent(row: AssetTreeRow): void {
    if (row.kind === 'folder') ui.addFolderToAgent({ id: row.id, name: row.name })
    // assetKind 一起给：资产名可能是 UUID、没有扩展名，Agent 标签要靠它选对类型图标
    else ui.addAssetToAgent({ name: row.name, url: row.url ?? '', ...(row.path ? { path: row.path } : {}), ...(row.parentId ? { folderId: row.parentId } : {}), ...(row.assetKind ? { kind: row.assetKind } : {}) })
  }
  function onTreeAddCanvas(row: AssetTreeRow): void {
    if (row.kind === 'folder') void folderAddToCanvas(row)
    else ui.addAssetToCanvas({ name: row.name, url: row.url ?? '', assetKind: row.assetKind })
  }

  /** 文件夹「添加到画布」：数量 > 10 时先弹确认。 */
  const folderConfirm = ref<{ folderId: string; name: string; count: number } | null>(null)
  let folderConfirmResolve: ((ok: boolean) => void) | null = null
  function confirmAddFolder(row: AssetTreeRow): Promise<boolean> {
    return new Promise((resolve) => {
      onFolderConfirmCancel()
      folderConfirm.value = { folderId: row.id, name: row.name, count: ui.assetItems.value.filter((a) => a.folderId === row.id).length }
      folderConfirmResolve = resolve
    })
  }
  async function folderAddToCanvas(row: AssetTreeRow): Promise<void> {
    const created = await ui.addFolderAssetsToCanvas(row.id, { confirm: confirmAddFolder.bind(null, row) })
    if (created) folderConfirm.value = null
  }
  function onFolderConfirmOk(): void {
    folderConfirmResolve?.(true)
    folderConfirmResolve = null
    folderConfirm.value = null
  }
  function onFolderConfirmCancel(): void {
    folderConfirmResolve?.(false)
    folderConfirmResolve = null
    folderConfirm.value = null
  }

  function onTreeMoveTo(payload: { row: AssetTreeRow; targetFolderId?: string }): void {
    if (payload.row.kind === 'folder') void ui.moveAssetFolderTo(payload.row.id, payload.targetFolderId)
    else void ui.moveSelectedAssets(payload.targetFolderId, [payload.row.id])
  }
  function onTreeSetIcon(payload: { row: AssetTreeRow; icon: string }): void {
    void ui.setAssetFolderIcon(payload.row.id, payload.icon)
  }
  function onTreeSetTags(payload: { row: AssetTreeRow; tags: string[] }): void {
    void ui.tagsForAsset(payload.row.id, payload.tags)
  }
  function onTreeDownload(row: AssetTreeRow): void {
    if (row.kind === 'folder') downloadFolder(row.id)
    else downloadAsset(row.url ?? '', row.name)
  }
  function onTreeRemove(row: AssetTreeRow): void {
    if (row.kind === 'folder') void ui.removeAssetFolder(row.id)
    else void ui.deleteAssetById(row.id)
  }
  async function onTreeDrop(payload: { from: AssetTreeRow; to: AssetTreeRow | null }): Promise<void> {
    const targetId = payload.to?.id
    if (payload.from.kind === 'folder') await ui.moveAssetFolderTo(payload.from.id, targetId)
    else await ui.moveSelectedAssets(targetId, [payload.from.id])
  }

  function onBatchTags(tags: string[]): void {
    for (const id of selectedIds.value) void ui.tagsForAsset(id, tags)
  }
  function onBatchRemove(): void {
    for (const id of [...selectedIds.value]) void ui.deleteAssetById(id)
    exitBatch()
  }
  function onBatchDownload(): void {
    for (const id of selectedIds.value) {
      const a = ui.assetItems.value.find((x) => x.id === id)
      if (a) downloadAsset(a.url, a.name)
    }
  }

  return {
    dialogMoveTargets,
    onTreeToggleSelect,
    onOpenAsset,
    onOpenThumb,
    onTreeRenameCommit,
    onTreeAddAgent,
    onTreeAddCanvas,
    folderConfirm,
    onFolderConfirmOk,
    onFolderConfirmCancel,
    onTreeMoveTo,
    onTreeSetIcon,
    onTreeSetTags,
    onTreeDownload,
    onTreeRemove,
    onTreeDrop,
    onBatchTags,
    onBatchRemove,
    onBatchDownload,
  }
}
