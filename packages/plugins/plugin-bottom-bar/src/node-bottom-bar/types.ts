import type { ResourceItem } from 'prosemirror-editor-bundle'

/** ProseMirrorEditor 暴露给底栏的编辑能力（原内联在 NodeBottomBar.vue） */
export interface BottomBarEditorHandle {
  insertResource?(item: ResourceItem): void
  replaceResource?(item: ResourceItem): boolean
  replaceResourceThumbByIds?(ids: readonly string[], url: string): boolean
  refreshChips?(): void
  markRefSlots?(): number
  removeRefChips?(ids: readonly string[]): boolean
  exportText?(): string
  setEditable?(next: boolean): void
}
