<script setup lang="ts">
/**
 * SelectionSaveAssetsToolbar —— 多选「上控制栏」的「加入资产库」按钮（**成品应用注册**）。
 *
 * 用户口径（2026-10-07）：「再注册一个多选的顶端控制按钮，功能也是一样只不过是可以贴入多张图」。
 *
 * 与节点右键「加入资产库」同一件事（都把图**贴进上传弹窗**），这里一次贴选中节点的每一张。
 *
 * 为什么这段内容住在 packages/ui 而不是多选插件里（用户明确要求）：
 *   「不要修改你的多选插件。它顶部悬浮操作栏有一个注册函数，你直接在自己的插件里面进行注册就行」。
 *   所以本组件跟 SelectionGroupToolbar（打组按钮）一样，是**一条区域条目** ——
 *   由 packages/ui 的 uiAssetUploadPlugin 经 ctx.selectionRegion.attach 挂上，
 *   多选插件一行都不用改。
 *
 * 它是什么：一段普通流式内容（自己不写 position/居中/反缩放），定位由 SelectionFrame 负责；
 * 上下文走能力包（needs:['selection']），与打组按钮同一条规矩。
 */
import { computed } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { SelectionCapability } from '@mini-canvas/canvas-render'
import { useCapability, useCanvasRender } from '@mini-canvas/canvas-render'
import { queueUploadsFromNodeIds } from '../composables/assetUploadBus'

const { ctx } = useCanvasRender()
const ThemedButton = useUiComponent('toolbarButton')

/** 当前选中集（能力包；needs 里声明了才拿得到 —— 见 uiAssetUploadPlugin 的 attach） */
const selection = useCapability<SelectionCapability>('selection')

const count = computed(() => selection?.ids().length ?? 0)
/** 有选中就能用（1 个也行：单张图照样能存） */
const enabled = computed(() => count.value >= 1)

/** 「加入资产库」图标（图片 + 归档，与节点右键那条同源语义） */
const ICON_SAVE_ASSET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'

/**
 * 点它：把选中节点里的每一张图**贴进上传弹窗**（多选 = 贴多张）。
 * 取图逻辑与节点右键那条共用（assetUploadBus），本组件只管"按下按钮"。
 */
function onSaveAssets(): void {
  if (!enabled.value) return
  const ids: string[] = selection?.ids() ?? []
  const doc = ctx.tryGet<{ getNode(id: string): { id: string; data?: Record<string, unknown> } | undefined }>('doc')
  queueUploadsFromNodeIds(ids, (id: string) => doc?.getNode(id))
}
</script>

<template>
  <!--
    定位与"整排一个背景块"由宿主的 .selection-frame-slot + .ntp-root 统一提供
    （见 plugin-multi-select 的 SelectionFrame）；这里**只放按钮本身**。

    为什么不再自套一层 .ntp-root：一个区域条目就是"整排里的一个控件"，不是"另一块面板"——
    再套一层会画出第二个背景块（用户看到的"两个背景"正是这么来的），
    和打组按钮（SelectionGroupToolbar）的写法也就对不上了。
  -->
  <component
    :is="ThemedButton || 'button'"
    type="button"
    title="加入资产库"
    aria-label="加入资产库"
    :icon="ICON_SAVE_ASSET"
    :disabled="!enabled"
    @click="onSaveAssets"
  >
    加入资产库
  </component>
</template>
