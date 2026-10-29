<script setup lang="ts">
/**
 * DemoButton —— 画布顶部状态栏左侧的「旋转示例」按钮（外壳插槽 shell.status）。
 *
 * 点击 = 建原图 + 新节点（连线）→ **新节点**进入「旋转与镜像」模式（见 imageRotateDemo.ts）。
 * 组件用宿主下发的 coreButton（与内置按钮同一套样式），不自绘。
 */
import { type Component } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'
import { createRotateDemo } from './imageRotateDemo'

const props = defineProps<{
  /** 宿主下发的默认按钮组件（SlotComposer sharedProps） */
  coreButton?: unknown
  /** 宿主下发的按钮档位：status（28×28，状态条档） */
  buttonTone?: 'dock' | 'status' | 'tab'
  /** 宿主下发的小提示（可选；本组件用 coreButton 自带的 AxTooltip） */
  showToast?: (msg: string) => void
}>()

const { ctx } = useCanvasContext()
const CoreButton = props.coreButton as Component | undefined

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>'

/** 视口中心（flow 坐标）：点按钮时用户多半在看画布中间，节点落中央比落角落好 */
function viewportCenter(): { x: number; y: number } | undefined {
  const vp = ctx.tryGet<{
    getPaneEl?(): HTMLElement | null
    screenToFlow?(x: number, y: number): { x: number; y: number }
  } | undefined>('viewport')
  const pane = vp?.getPaneEl?.()
  if (!pane || !vp?.screenToFlow) return undefined
  const r = pane.getBoundingClientRect()
  if (!(r.width > 0 && r.height > 0)) return undefined
  try {
    return vp.screenToFlow(r.left + r.width / 2, r.top + r.height / 2)
  } catch {
    return undefined
  }
}

function run(): void {
  const target = createRotateDemo(ctx, viewportCenter())
  if (!target) props.showToast?.('旋转示例：建节点失败（图片插件未启用？）')
}
</script>

<template>
  <CoreButton
    v-if="CoreButton"
    :tone="buttonTone ?? 'status'"
    variant="icon"
    title="旋转示例：建两个相连图片节点并进入旋转模式"
    :icon="ICON"
    @click="run"
  />
</template>
