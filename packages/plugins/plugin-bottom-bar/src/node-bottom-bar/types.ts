import type { ResourceItem } from 'prosemirror-editor-bundle'

/** ProseMirrorEditor 暴露给底栏的编辑能力（原内联在 NodeBottomBar.vue） */
export interface BottomBarEditorHandle {
  insertResource?(item: ResourceItem): void
  /** 在当前光标处插入纯文本（底栏最左侧的 @ 按钮用） */
  insertText?(text: string): void
  /** 用纯文本整体替换正文（预设提示词用：支持换行，按段落重建） */
  setText?(text: string): void
  /** 把光标放到正文末尾并聚焦（填完预设后继续打字） */
  focusEnd?(): void
  replaceResource?(item: ResourceItem): boolean
  replaceResourceThumbByIds?(ids: readonly string[], url: string): boolean
  refreshChips?(): void
  markRefSlots?(): number
  removeRefChips?(ids: readonly string[]): boolean
  exportText?(): string
  setEditable?(next: boolean): void
}
