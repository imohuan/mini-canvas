/**
 * useAssetRefOpen —— 应用层**监听**「引用被点了」这条系统事件，并做出响应。
 *
 * 用户口径（2026-10-08）：输入框里的标签被点，应用层要打开预览 / 资产管理与 Agent 插件**解耦**。
 * 所以链路是：
 *   输入框节点（只管抛点击） → Agent 插件转发成系统事件 `agent:ref-click` → 本组合式函数消费
 *
 * 三方互不认识：本文件不 import 任何插件组件，插件也不知道谁在听；
 * 没人监听也不报错（事件是广播，不是调用）。
 *
 * 必须挂在**画布渲染子树内**（`useCanvasRender()` 取 ctx 用）—— 调用点是 AssetUiSlot，
 * 它挂在 CanvasHost 的 #ui 槽里。
 */
import { onBeforeUnmount } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { REF_CLICK_EVENT, type RefClickPayload } from '@mini-canvas/plugin-agent'
import { assetManager, assetPreview } from './assetUiBus'
import { assetUrlOf, kindOfExt } from './assetRefOpen'

/**
 * 订阅事件。返回取消订阅函数（组件卸载时自动调，重复挂载不会堆积）。
 *
 * 分流口径全在**载荷自己身上**（不猜、不查库）：
 *   ext      → 单个文件 → 打开全屏预览（kind 由扩展名定）
 *   无 ext + folderId → 资产库文件夹 → 打开资产管理并展开到那一层（带引导提示）
 *   其它     → 不管（例如 node 引用，Agent 自己已经聚焦过画布了）
 */
export function useAssetRefOpen(): void {
  const { ctx } = useCanvasRender()
  const sub = ctx.on(REF_CLICK_EVENT, (payload?: RefClickPayload) => {
    if (!payload || payload.type !== 'asset') return
    if (payload.ext) {
      assetPreview.value = {
        name: payload.name,
        kind: kindOfExt(payload.ext),
        url: assetUrlOf(payload.path),
      }
      return
    }
    // 目录：折叠到只剩这一条链 + 给一条引导提示（`fromRef: true`）
    assetManager.value = {
      open: true,
      ...(payload.folderId ? { folderId: payload.folderId } : {}),
      fromRef: true,
      focusToken: assetManager.value.focusToken + 1,
    }
  })
  onBeforeUnmount(() => sub.dispose())
}
