/**
 * mediaPreviewBus —— 视频节点全屏预览的会话状态（module 级共享响应式，零 DOM）。
 *
 * 与 plugin-bottom-bar 的 mediaPreview.ts 同一条设计：浮层（overlay 槽组件）与
 * 发起方（VideoContent 内容段）是两个兄弟组件，只共享模块级 ref。
 * 视频只有单源，不需要 list/index 轮播，所以比底栏那份更薄。
 */
import { ref } from 'vue'

export interface VideoPreviewItem {
  /** 标题（MediaViewer 顶栏显示） */
  name: string
  /** MediaViewer 的视频分支 */
  kind: 'video'
  /** 视频地址（会话级 / 资源库均可） */
  url: string
}

const current = ref<VideoPreviewItem | null>(null)

/** 打开全屏预览 */
export function openPreview(item: VideoPreviewItem): void {
  current.value = item
}

/** 关闭全屏预览（MediaViewer 的 close 事件；幂等） */
export function closePreview(): void {
  current.value = null
}

/** 当前预览项（null = 没在预览） */
export function previewItem(): VideoPreviewItem | null {
  return current.value
}
