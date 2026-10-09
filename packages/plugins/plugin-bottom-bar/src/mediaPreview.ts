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
  /** 素材来源节点 id（删除=断开它连出的线；无来源的老素材没有） */
  nodeId?: string
  /** 图片/视频地址 */
  url?: string
  /** 文本内容 */
  text?: string
  /** 媒体种类（决定用 img / video / 纯文本渲染） */
  kind: 'image' | 'video' | 'audio' | 'text'
}

const current = ref<PreviewItem | null>(null)
/** 预览是从哪个节点的底栏点开的（删除连线时找「素材 → 这个节点」用） */
let currentOwner = ''

/** 打开全屏预览（owner = 点开时所在节点的 id） */
export function openPreview(item: PreviewItem, owner?: string): void {
  current.value = item
  currentOwner = owner ?? ''
}

/** 预览发起节点的 id（没有返回空串） */
export function previewOwner(): string {
  return currentOwner
}

/** 关闭全屏预览（Esc / 点背景 / 关闭按钮都调它；幂等） */
export function closePreview(): void {
  current.value = null
  currentOwner = ''
}

/** 当前预览项（null = 没在预览） */
export function previewItem(): PreviewItem | null {
  return current.value
}

/** 是否正在预览 */
export function previewActive(): boolean {
  return current.value !== null
}
