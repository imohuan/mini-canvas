import type { Ref } from 'vue'
import type { AssetTreeRow } from '../tree/types'

/** 弹窗里树动作共享的状态与入口参数 */
export interface ManageDialogTreeContext {
  rows: Ref<AssetTreeRow[]>
  flatFolders: Ref<{ id: string; name: string; depth: number }[]>
  batchOn: Ref<boolean>
  selectedIds: Ref<string[]>
  selectAnchorId: Ref<string | null>
  renamingId: Ref<string | null>
  exitBatch: () => void
}
