/**
 * 发布前的确认文案（纯函数，方便单测与面板共用）。
 *
 * 用户口径 2026-11-06：新增 / 发布这类会改内容的动作也要走项目里的确认框，
 * 不能直接执行。文案按“发布到哪里”区分，并明确会新增多少内容。
 */
import type { ConfirmOptions } from '@plume-canvas/canvas-render'

export function publishConfirmText(kind: 'canvas' | 'storyboard', count: number): ConfirmOptions {
  return {
    title: kind === 'canvas' ? '发送到画布' : '创建分镜组',
    description:
      (kind === 'canvas'
        ? '会把选中的格子发送到画布，并放进一个分组节点里。'
        : '会用选中的格子创建一个分镜组，组内可以拖拽排序。') +
      '\n\n这次发布会新增 ' + count + ' 个内容。',
    confirmText: kind === 'canvas' ? '发送' : '创建',
    cancelText: '取消',
  }
}
