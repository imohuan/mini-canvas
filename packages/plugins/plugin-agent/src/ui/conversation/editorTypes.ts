/** 编辑器暴露的方法（组件库 defineExpose 的方法在实例类型里未声明）。 */
import { ProseMirrorEditor } from 'prosemirror-editor-bundle'
import type { ResourceItem } from 'prosemirror-editor-bundle'

export type ProseMirrorEditorExposed = InstanceType<typeof ProseMirrorEditor> & {
  insertResource(item: ResourceItem): void
  setText(text: string): void
  /** 重画正文里的标签（视频首帧取到后补图用） */
  refreshChips?(): void
  menuOpen?: boolean
}
