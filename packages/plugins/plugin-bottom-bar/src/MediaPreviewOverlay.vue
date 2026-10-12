<script setup lang="ts">
/**
 * 根节点是 Teleport：插槽宿主（SlotHost）下发的 class/data-slot-* 继承不了，
 * 不关掉属性继承 Vue 每次渲染都会警告一次（实测刷屏）。我们本来就不用那些属性。
 */
defineOptions({ inheritAttrs: false })
/**
 * MediaPreviewOverlay —— 素材卡的全屏预览浮层（注册在 overlay 槽，Teleport 到 body）。
 *
 * 视觉与交互整只交给主题注册的 MediaViewer（AxImageViewer 同款：滚轮缩放 / 拖拽 /
 * 旋转 / 翻转 / 下载 / 键盘快捷键）。本组件只剩两件事：
 *   1. 把 mediaPreview 会话状态翻译成 item prop；
 *   2. 删除 = 断开「素材节点 → 发起节点」这条连线（这是底栏自己的业务语义）。
 */
import { useCanvasRender } from "@mini-canvas/canvas-render"
import {
  closePreview,
  currentPreview,
  previewItem,
  previewOwner,
  setPreviewIndex,
} from "./mediaPreview"

// MediaViewer 是主题注册件（useUiComponent("mediaViewer")，换主题时跟着换）——
// 这样也避开 T08 依赖方向守卫：业务插件不得把默认主题当组件库 import。
import { computed } from "vue"
import { useUiComponent } from "@mini-canvas/canvas-render"
const MediaViewer = useUiComponent("mediaViewer")

const { ctx, renderEdges } = useCanvasRender()

const item = computed(() => previewItem())

/**
 * 给 MediaViewer 的 item：补上 list / index —— 于是预览里自带 ← / → 切换与页码，
 * 不用我们在浮层里再做一套切换（用户要的就是这个现成能力）。
 * url / name 跟着当前下标走（音频/视频那条分支读的是 item.url，不是内部分页的 currentUrl）。
 */
const viewerItem = computed(() => {
  const cur = item.value
  if (!cur) return null
  const list = cur.list ?? []
  if (list.length < 2) return { name: cur.name, kind: cur.kind, url: cur.url, text: cur.text }
  const index = Math.min(Math.max(cur.index ?? 0, 0), list.length - 1)
  return {
    name: cur.names?.[index] ?? cur.name,
    kind: cur.kind,
    url: list[index],
    text: cur.text,
    list,
    index,
  }
})

/** 删除 = 断开「预览的素材节点 → 当前节点」这条连线（连线没了，素材卡自然消失） */
function removeMaterial(): void {
  // 按**正在看的那张**删（多张同类素材用 ← / → 切过之后，删的必须是当前这张）
  const cur = currentPreview()
  if (!cur?.nodeId) return
  const edge = renderEdges.value.find((e) => e.source === cur.nodeId && e.target === previewOwner())
  const doc = ctx.tryGet<{ removeEdges(ids: string[]): number }>("doc")
  if (edge && doc) doc.removeEdges([edge.id])
  closePreview()
}
</script>

<template>
  <Teleport to="body">
    <MediaViewer
      :item="viewerItem"
      :on-delete="removeMaterial"
      @index="setPreviewIndex"
      data-testid="media-preview-overlay"
      @close="closePreview()"
    />
  </Teleport>
</template>
