/**
 * plugin-node-find —— 节点搜索插件（Ctrl/Cmd+F 打开浮层搜索/跳转节点）。
 *
 * v2 复刻老版 packages/canvas-core/src/plugins/node-find：
 * - 老版 install 里 context.registerShortcut('ctrl+f', openOverlay) → v2 走命令 keys：注册命令
 *   node-find:open（keys:['mod+f']），渲染层 CanvasHost 统一分发键盘，插件不自己绑 window。
 * - 老版 context.actions.getNodes() → v2 ctx.get('doc').getNodes()。
 * - 老版 context.viewport.setCenter(node.x+128,…)（128 半宽假设）→ v2 用 nodeLayout.getNodeRect(id)
 *   取矩形中心（实测尺寸，更准）。
 * - UI 自管：命令执行时 createApp 挂 body（Teleport 在组件内），onClose 卸载；插件热卸经 ctx.effect 自动回收。
 *
 * 依赖方向：只依赖内核服务（doc/view，宿主恒在注入）。不依赖宿主 demo / 其它插件。
 */
import { createApp, h } from 'vue'
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import NodeFindOverlay from './NodeFindOverlay.vue'

// view 的直访类型（ctx.view）由 canvas-data 集中声明
// （作者 SDK 上游，见 renderServiceContracts），本包不必再就地 declare。
export const name = 'node-find'
export const inject = ['doc', 'view'] as string[]

export function apply(ctx: Context) {
  let appInstance: ReturnType<typeof createApp> | null = null
  let containerEl: HTMLDivElement | null = null
  /** P2-3：浮层打开期间的 doc 订阅（closeOverlay 退订） */
  let unsubStore: (() => void) | null = null

  function openOverlay(): void {
    if (appInstance) return // 已打开：幂等 no-op
    containerEl = document.createElement('div')
    document.body.appendChild(containerEl)
    // P2-3：浮层打开期间订阅 nodeStore 增删/改名 → 每次变化 bump version 触发浮层重算，结果不陈旧
    const nodesVersion = { value: 0 }
    unsubStore = ctx.doc.subscribe(() => { nodesVersion.value += 1 })
    appInstance = createApp({
      render() {
        return h(NodeFindOverlay, {
          getNodes: () => ctx.doc.getNodes(),
          refreshKey: nodesVersion.value,
          onFocus(nodeId: string) {
            focusNode(nodeId)
          },
          onClose: closeOverlay,
        })
      },
    })
    appInstance.mount(containerEl)
  }

  function closeOverlay(): void {
    if (appInstance) {
      appInstance.unmount()
      appInstance = null
    }
    if (containerEl) {
      containerEl.remove()
      containerEl = null
    }
    // P2-3：关闭浮层即退订 nodeStore 变化（防泄漏）
    if (unsubStore) {
      unsubStore()
      unsubStore = null
    }
  }

  /** 聚焦某节点：统一走 view.fitTo，保持当前缩放、只平移（不打断用户视野） */
  function focusNode(nodeId: string): void {
    // fitTo 内部按实测矩形算中心；节点不存在时返回 false，不抛。
    ctx.view.fitTo([nodeId], { keepZoom: true })
  }

  // —— 注册打开命令（keys 由渲染层统一分发；热卸时命令随 scope 自动回收）——
  ctx.commands.register({
    id: 'node-find:open',
    title: '搜索节点',
    keys: ['mod+f'],
    order: 30,
    run: () => openOverlay(),
  })

  // —— 插件热卸/宿主 stop：卸载浮层，防 DOM 泄漏 ——
  ctx.effect(() => () => closeOverlay())
}

/** 兼容旧装配的 PluginModule 出口 */
export const nodeFindPlugin: PluginModule = { name, inject, apply }
