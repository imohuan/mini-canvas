/**
 * mediaPreview —— 全屏媒体预览的会话状态（module 级共享响应式，零 DOM）。
 *
 * 用户要求（2026-09-30）：素材卡点开预览时「要的是全屏，是整个视图」，
 * 不是缩在底栏那一小块里看。素材卡（底栏）与预览浮层是两个兄弟组件，只共享 ctx，
 * 故状态放这里 —— 与 cropSession / referenceMode 同一条理由（纯 UI 状态不该进节点 data）。
 */
import { ref } from 'vue'

/** 一个待预览的素材（只带渲染需要的字段） */
export interface PreviewItem {
  /** 素材名（标题栏显示） */
  name: string
  /** 图片/视频地址 */
  url?: string
  /** 文本内容 */
  text?: string
  /** 媒体种类（决定用 img / video / 纯文本渲染） */
  kind: 'image' | 'video' | 'audio' | 'text'
}

const current = ref<PreviewItem | null>(null)

/** 打开全屏预览 */
export function openPreview(item: PreviewItem): void {
  current.value = item
}

/** 关闭全屏预览（Esc / 点背景 / 关闭按钮都调它；幂等） */
export function closePreview(): void {
  current.value = null
}

/** 当前预览项（null = 没在预览） */
export function previewItem(): PreviewItem | null {
  return current.value
}

/** 是否正在预览 */
export function previewActive(): boolean {
  return current.value !== null
}

