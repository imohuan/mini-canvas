import { onBeforeUnmount, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { Disposable } from '@mini-canvas/kernel'
import { GRAPH_VIEWPORT_KEY } from '@mini-canvas/canvas-data'
import { applyCanvasInteractionChangeInto, resolveCanvasInteraction } from '../../contracts/canvasInteractionSettings'
import type { CanvasInteractionSettings } from '../../contracts/canvasInteractionSettings'
import type { CanvasHostHandle } from '../createMiniCanvasHost'
import type { CanvasInteractionState } from '../../contracts/interactionContext'
import type { ViewportState } from '../../viewport/viewportService'

export function useCanvasLifecycle(opts: {
  host: CanvasHostHandle
  hostRef: { value: CanvasHostHandle | undefined }
  persistViewport: boolean
  emitReady: (host: CanvasHostHandle) => void
  emitPluginIssue: (payload: { name: string; lifecycle: string }) => void
  surfaceReady: Ref<boolean>
  mountError: Ref<string>
  interactionSettings: CanvasInteractionSettings
  interaction: CanvasInteractionState
  savedViewport: Ref<ViewportState | undefined>
  nodeEpoch: Ref<number>
  syncFromStore: () => void
  syncSelected: () => void
  applyTheme: () => boolean
  refreshCull: () => void
  rebuildLinkedIds: () => void
  syncNodesFromStore: () => void
  flushSave: () => void
  onVisibilityChange: () => void
  resetViewportMoveIfIdle: () => void
  onKeydown: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  onCopy: (e: ClipboardEvent) => void
  onCut: (e: ClipboardEvent) => void
  onGlobalPointerDown: (e: MouseEvent) => void
  edgeVisualToProvide: unknown
  cleanup: {
    clearDragProtection: () => void
    disposeNodeDrag: () => void
    disposeRenderState: () => void
    disposeViewport: () => void
  }
}) {
  const {
    host,
    hostRef,
    surfaceReady,
    mountError,
    interactionSettings,
    interaction,
    savedViewport,
    nodeEpoch,
  } = opts

  let subs: Disposable[] = []
  let keydownBound = false
  let pasteBound = false
  let clipboardWriteBound = false
  let unsubStore: (() => void) | undefined
  let unsubEdge: (() => void) | undefined
  let unsubSel: (() => void) | undefined
  let stopEdgeOnTopWatch: (() => void) | undefined

  onMounted(async () => {
    try {
      // 画布交互配置：读当前值 + 订阅设置面板改动实时生效（unmount 随 subs 统一回收）
      const settingsStore = host.ctx.get<{ get(key: string): unknown; onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
      Object.assign(interactionSettings, resolveCanvasInteraction((key) => settingsStore.get(key)))
      subs.push(
        settingsStore.onChange((key, value) => {
          // 原地写回（引用不变，Vue 响应式可感知 → VueFlow 绑定实时跟随）
          applyCanvasInteractionChangeInto(interactionSettings, key, value)
          // 可见剔除配置变化 → 立即重算集合并重灌（不等下一次视口变化，否则关掉剔除画面不恢复）
          if (key === 'visibleCullEnabled' || key === 'visibleCullBuffer' || key === 'cullCompactShells') {
            opts.refreshCull()
            opts.rebuildLinkedIds()
            opts.syncNodesFromStore()
          }
        }),
      )

      // 订阅 store 变化自动刷渲染态（nodeStore 与 edgeStore 任一变化都触发整图重刷）
      unsubStore = host.nodeStore.subscribe(opts.syncFromStore)
      unsubEdge = host.edgeStore.subscribe(opts.syncFromStore)
      // 连线置顶开关变化 → 重灌渲染态（给 edges 重新算 zIndex）
      stopEdgeOnTopWatch = watch(
        () => (opts.edgeVisualToProvide as { edgeOnTop?: boolean } | undefined)?.edgeOnTop,
        () => { if (hostRef.value) opts.syncFromStore() },
      )

      // 订阅内核 Selection(选中单源)：点击/删除/撤销等只写内核，这里投影给 CustomEdge 高亮
      unsubSel = host.selection.onChange(opts.syncSelected)
      opts.syncSelected() // 初始同步一次(seed 恢复不触发 onChange)

      // 主题 + nodeTypes 装配
      opts.applyTheme()

      // 初始灌入：seed/restore 发生在 Provider 建宿主时（早于本组件订阅），
      // 不会触发回调，这里主动同步一次把当前 store 节点渲染出来。
      opts.syncFromStore()

      // 订阅插件热装/热卸：重装配主题与 nodeTypes + bump epoch 触发 VueFlow 重挂
      // (overlay 槽内容由 CanvasSurface 内 SlotHost 自行订阅刷新，无需在此处理)
      // 插件装卸的重挂请求走**微任务合并**：一次装载会同时命中下面 4 个订阅源（事件 + 三个注册场），
      // 各自 bump nodeEpoch 会让 VueFlow 连挂 4 次（启动时装 N 个插件 = 4N 次整树重挂 →
      // 画布闪烁 / 图片节点反复重载 / 每次重挂全量重校验边）。合并成一帧内一次重挂，语义不变。
      let remountQueued = false
      function queueRemount(): void {
        const typesChanged = opts.applyTheme()
        // 装配结果没变（该插件不提供壳/主题组件）→ 不重挂，画布零扰动
        if (!typesChanged) return
        if (remountQueued) return
        remountQueued = true
        // **防抖窗口 120ms**：插件启动风暴期间（N 个插件逐个装，每个都 bump），把重挂一直推迟到
        // 风暴安静 120ms 后 —— 一批 N 个插件只重挂 1 次，而不是 N 次。120ms 足以覆盖单个插件
        // 的装载间隔，又不至于让用户在装卸单个插件后感觉到可感知的延迟。
        const sched: (fn: () => void, ms: number) => void =
          typeof window !== 'undefined'
            ? (fn, ms) => window.setTimeout(fn, ms)
            : (fn) => Promise.resolve().then(fn)
        sched(() => {
          remountQueued = false
          nodeEpoch.value += 1
        }, 120)
      }
      subs.push(
        host.ctx.on('ctx:plugin-installed', () => { queueRemount() }),
        host.ctx.on('ctx:plugin-uninstalled', () => { queueRemount() }),
        // 运行期主题槽/节点段 occupant 被改（不经过插件装卸）也要重装配 + 重挂渲染子树
        { dispose: host.themeRegistry.subscribe(() => { queueRemount() }) },
        { dispose: host.nodeRegistry.subscribe(() => { queueRemount() }) },
        // node/shell 场（换壳）变了也要重装配：插件热装/热卸走上面的 lifecycle 事件，
        // 但运行期直接 add/wrap 换壳（不经过插件装卸）只有订场才知道，否则"换了壳却没生效"。
        {
          dispose: (
            host.ctx.registryOf<unknown>('node/shell') as unknown as {
              subscribe(fn: () => void): { dispose(): void }
            }
          ).subscribe(() => {
            queueRemount()
          }).dispose,
        },
        // 运行期插件装载失败上报(事件驱动)：内核在插件 setup/config 抛错时经 ctx:lifecycle-change ERROR 广播。
        // 此处只转发 ERROR(装载失败)这一非正常终态，不误报 ACTIVE/卸载等正常跳变。
        host.ctx.on('ctx:lifecycle-change', ({ name, lifecycle }) => {
          if (lifecycle === 'error') opts.emitPluginIssue({ name, lifecycle: String(lifecycle) })
        }),
      )

      // 键盘
      window.addEventListener('keydown', opts.onKeydown)
      keydownBound = true
      /*
       * 把“某节点此刻正被编辑哪些字段”暴露给云端同步插件（只读探针）。
       *
       * 为什么由宿主提供：拖拽/框选是 canvas-render 维护的交互状态，插件按服务名取不到；
       * 但云端合并需要它来决定“哪些字段先别覆盖”。宿主提供窄接口，插件只需 tryGet，
       * 没有这份服务时安全降级（不同步暂停整张画布）。
       */
      subs.push({
        dispose: host.ctx.inject('cloud-client/edit-guard', (nodeId: string): ReadonlySet<'position' | 'data' | 'size'> => {
          const held = new Set<'position' | 'data' | 'size'>()
          const act = interaction.activity.value
          if (act.nodeDragging && act.nodeDragId === nodeId) held.add('position')
          if (act.nodeResizing && act.nodeResizeId === nodeId) held.add('size')
          return held
        }),
      })
      // 原生粘贴（仲裁场）：插件经 registryOf('clipboard/paste') 声明粘贴动作，宿主统一派发
      window.addEventListener('paste', opts.onPaste)
      pasteBound = true
      // 原生复制/剪切（仲裁场）：插件经 registryOf('clipboard/copy') 声明"复制画布节点"，
      // 命中时写一个"来自画布"的标记进系统剪贴板（粘贴仲裁据此判"该贴节点还是贴外部媒体"）。
      window.addEventListener('copy', opts.onCopy)
      window.addEventListener('cut', opts.onCut)
      clipboardWriteBound = true
      // 全局按下点（capture）：拖线开始时作为"拖拽起点"，用于算拖了多远
      document.addEventListener('mousedown', opts.onGlobalPointerDown, true)

      // 页面隐藏/离开落盘
      window.addEventListener('visibilitychange', opts.onVisibilityChange)
      window.addEventListener('pagehide', opts.flushSave)

      // paneDragging 兜底自愈：指针抬起 / 窗口失焦 / 页面隐藏时，若还残留 paneDragging 就清掉
      // （正常路径已由 onMoveEnd 清；这里防漏发 moveEnd 导致永久卡 true 把端口等显隐门压死）。
      window.addEventListener('pointerup', opts.resetViewportMoveIfIdle, true)
      window.addEventListener('pointercancel', opts.resetViewportMoveIfIdle, true)
      window.addEventListener('blur', opts.resetViewportMoveIfIdle)
      window.addEventListener('visibilitychange', opts.resetViewportMoveIfIdle)

      // 读存档视口(仅需持久化时)：有 → 首次挂载后恢复到停的位置；无 → fitView 基线。
      // 在 surfaceReady=true(触发 CanvasSurface 挂载)前读好，供 surfaceRef 首次触发的恢复逻辑取用。
      if (opts.persistViewport) {
        const vp = await host.save.get<ViewportState>(GRAPH_VIEWPORT_KEY, 'canvas')
        savedViewport.value = vp
}
      surfaceReady.value = true
      opts.emitReady(host)
    } catch (err) {
      mountError.value = err instanceof Error ? err.message : String(err)
      surfaceReady.value = true
    }
  })

  onBeforeUnmount(() => {
    opts.cleanup.clearDragProtection()
    opts.cleanup.disposeNodeDrag()
    opts.cleanup.disposeRenderState()
    unsubStore?.()
    unsubEdge?.()
    unsubSel?.()
    stopEdgeOnTopWatch?.()
    opts.cleanup.disposeViewport()
    for (const s of subs) s.dispose()
    if (keydownBound) window.removeEventListener('keydown', opts.onKeydown)
    if (pasteBound) window.removeEventListener('paste', opts.onPaste)
    if (clipboardWriteBound) {
      window.removeEventListener('copy', opts.onCopy)
      window.removeEventListener('cut', opts.onCut)
    }
    document.removeEventListener('mousedown', opts.onGlobalPointerDown, true)
    window.removeEventListener('visibilitychange', opts.onVisibilityChange)
    window.removeEventListener('pagehide', opts.flushSave)
    window.removeEventListener('pointerup', opts.resetViewportMoveIfIdle, true)
    window.removeEventListener('pointercancel', opts.resetViewportMoveIfIdle, true)
    window.removeEventListener('blur', opts.resetViewportMoveIfIdle)
    window.removeEventListener('visibilitychange', opts.resetViewportMoveIfIdle)
    // 只落盘，不停止内核：生命周期归 CanvasProvider，且它会在子组件全部卸载后再 stop。
    void host.save.flush()
  })

}
