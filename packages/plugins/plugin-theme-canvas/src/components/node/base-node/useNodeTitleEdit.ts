import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { NodeWrite } from '@mini-canvas/canvas-render'
import type { ViewContract } from '@mini-canvas/canvas-data'
import { isRectFullyVisible } from '../titleEdit'

export interface NodeTitleEditInput {
  view: () => ViewContract | undefined
  id: string
  selected: () => boolean | undefined
  visibleRect: Ref<{ x: number; y: number; w: number; h: number } | null>
  nodeWrite: NodeWrite | undefined
}

/** 标题空间余量（flow 坐标）：判定聚焦时向上多留这么多，保证标题不被视口裁掉 */
const TITLE_FOCUS_PAD = 32

/** 就地改名：F2 / 双击进入，提交时先退出编辑态再写回。 */
export function useNodeTitleEdit(input: NodeTitleEditInput) {
  const isEditingTitle = ref(false)

  watch(
    () => input.selected(),
    (sel) => {
      if (sel) document.addEventListener('keydown', onTitleEditKeydown)
      else {
        document.removeEventListener('keydown', onTitleEditKeydown)
        if (isEditingTitle.value) cancelTitleEdit()
      }
    },
    { immediate: true },
  )

  function onTitleEditKeydown(e: KeyboardEvent) {
    if (e.key !== 'F2' || isEditingTitle.value) return
    const t = e.target as HTMLElement | null
    if (!t) return
    const tag = t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
    if (!input.nodeWrite) return
    startTitleEdit()
  }

  function startTitleEdit() {
    if (isEditingTitle.value) return
    isEditingTitle.value = true
    focusNodeIfNeeded()
  }

  function focusNodeIfNeeded(): void {
    const viewService = input.view()
    const rect = viewService?.getNodeRect(input.id)
    const view = input.visibleRect?.value
    if (!rect || !view || !viewService) return
    const withTitle = {
      x: rect.x,
      y: rect.y - TITLE_FOCUS_PAD,
      w: rect.w,
      h: rect.h + TITLE_FOCUS_PAD,
    }
    if (isRectFullyVisible(withTitle, view)) return
    viewService.fitTo([input.id], {
      keepZoom: true,
      onlyIfOutOfView: true,
      margin: TITLE_FOCUS_PAD,
    })
  }

  function commitTitleEdit(value: string): void {
    const next = value || undefined
    if (input.nodeWrite) {
      // 先结束编辑态再写回：写回会让 label 变化，此时组件已是"非编辑态"，插值能正常刷新成归一化结果
      isEditingTitle.value = false
      input.nodeWrite(input.id, next === undefined ? { label: undefined } : { label: next })
      return
    }
    isEditingTitle.value = false
  }

  function cancelTitleEdit() {
    isEditingTitle.value = false
  }
  onBeforeUnmount(() => document.removeEventListener('keydown', onTitleEditKeydown))

  return {
    isEditingTitle,
    startTitleEdit,
    commitTitleEdit,
    cancelTitleEdit,
  }
}
