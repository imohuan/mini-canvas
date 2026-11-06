import type { ResourceItem } from 'prosemirror-editor-bundle'

/** ProseMirrorEditor 暴露给底栏的编辑能力（原内联在 NodeBottomBar.vue） */
export interface BottomBarEditorHandle {
  insertResource?(item: ResourceItem): void
  /** 在当前光标处插入纯文本（底栏最左侧的 @ 按钮用） */
  insertText?(text: string): void
  replaceResource?(item: ResourceItem): boolean
  replaceResourceThumbByIds?(ids: readonly string[], url: string): boolean
  refreshChips?(): void
  markRefSlots?(): number
  removeRefChips?(ids: readonly string[]): boolean
  exportText?(): string
  setEditable?(next: boolean): void
}
