import { ref, type Ref } from 'vue'
import type { MultiSelectRect } from '../multiSelectEngine'

export type GroupDragPoint = { x: number; y: number }

export interface GroupDragState {
  isDragging: Ref<boolean>
  nodeDragging: Ref<boolean>
  dragStartUnion: Ref<MultiSelectRect | null>
  dragDelta: Ref<GroupDragPoint>
  lastClient: Ref<GroupDragPoint | null>
  dragStartPositions: Ref<Map<string, { abs: GroupDragPoint; base: GroupDragPoint }>>
  livePositions: Ref<Map<string, GroupDragPoint>>
}

/** 整组拖拽的共享响应式状态；必须先于 refreshFrame 的 immediate watch 创建。 */
export function useGroupDragState(): GroupDragState {
  return {
    isDragging: ref(false),
    nodeDragging: ref(false),
    dragStartUnion: ref<MultiSelectRect | null>(null),
    dragDelta: ref<GroupDragPoint>({ x: 0, y: 0 }),
    lastClient: ref<GroupDragPoint | null>(null),
    dragStartPositions: ref<Map<string, { abs: GroupDragPoint; base: GroupDragPoint }>>(new Map()),
    livePositions: ref<Map<string, GroupDragPoint>>(new Map()),
  }
}
