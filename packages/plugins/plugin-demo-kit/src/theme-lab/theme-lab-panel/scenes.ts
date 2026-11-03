import { nextTick } from 'vue'
import { OPTIONAL_PLUGINS, PLUGIN_LABELS, SCENE_META } from '../catalog'
import type { ThemeLabScene } from '../catalog'
import { releaseHeld, replayScene, type ReplayContext } from '../replay'
import type { ThemeLabState } from './state'

export function useThemeLabScenes(
  state: ThemeLabState,
  deps: {
    showToast: (message: string) => void
    scheduleRedraw: () => void
    syncMode: () => void
    replayCtx: () => ReplayContext
  },
) {
  const { props, enabledPlugins, connectedPlugins, scene, providerKey, ready, host, stageEl, runtime } = state
  const showToast = deps.showToast
  const scheduleRedraw = deps.scheduleRedraw
  const syncMode = deps.syncMode
  const replayCtx = deps.replayCtx

  function togglePlugin(name: string): void {
    if (!OPTIONAL_PLUGINS.includes(name as (typeof OPTIONAL_PLUGINS)[number])) return
    const next = new Set(enabledPlugins.value)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    enabledPlugins.value = OPTIONAL_PLUGINS.filter((item) => next.has(item))
    if (!props.embedded) connectedPlugins.value = ['theme-default', 'demo-theme-lab', ...enabledPlugins.value]
    if (scene.value !== 'base' && !sceneAvailableFor(scene.value)) {
      scene.value = 'base'
    }
    providerKey.value += 1
    ready.value = false
    nextTick(() => {
      syncMode()
      scheduleRedraw()
    })
  }

  function sceneAvailableFor(id: ThemeLabScene): boolean {
    const meta = SCENE_META.find((item) => item.id === id)
    return !meta?.plugin || enabledPlugins.value.includes(meta.plugin)
  }

  async function selectScene(id: ThemeLabScene): Promise<void> {
    if (!sceneAvailableFor(id)) {
      const meta = SCENE_META.find((item) => item.id === id)
      showToast('需要先安装 ' + (PLUGIN_LABELS[meta?.plugin ?? ''] ?? meta?.plugin ?? '对应插件'))
      return
    }
    releaseHeld(replayCtx())
    resetAllNodes()
    const token = ++runtime.replayToken
    scene.value = id
    seekSceneSelection(id)
    scheduleRedraw()
    if (id === 'align' || id === 'box' || id === 'cut') {
      await nextTick()
      await replayScene(id, replayCtx())
      if (token !== runtime.replayToken) return
    }
    burstRedraw()
  }

  /**
   * 把四个真实节点放回标准位。
   *
   * 对齐回放会真实拖动节点；如果每次都从上次留下的位置继续，几轮之后节点会跑到画布外。
   * 走 graph 的唯一写入口，所以拖动历史/渲染态仍然一致。
   */
  function resetAllNodes(): void {
    const h = host.value
    if (!h) return
    const home: Record<string, { x: number; y: number }> = {
      'lab-text': { x: 60, y: 84 },
      'lab-image': { x: 420, y: 60 },
      'lab-warning': { x: 60, y: 300 },
      'lab-danger': { x: 60, y: 440 },
    }
    const patches = Object.entries(home)
      .filter(([id]) => Boolean(h.nodeStore.getNode(id)))
      .map(([id, position]) => ({ id, patch: { position } }))
    if (!patches.length) return
    h.graph.updateNodes(patches)
    requestAnimationFrame(() => {
      if (host.value !== h) return
      // 节点就地回位后再取景一次，保证用户看到的就是标准舞台
      h.view.fitView(0.14)
      burstRedraw()
    })
  }

  /** 插件/画布改 DOM 是分几帧完成的：多补几帧，指示线才不会停在旧目标上 */
  function burstRedraw(): void {
    for (const delay of [0, 60, 140, 280, 520, 900]) window.setTimeout(scheduleRedraw, delay)
  }

  /**
   * 把预览里的四个真实节点放进可见区。
   *
   * CanvasHost 在 persistViewport=false 时刻意不自动取景（不替调用方动视口）；
   * 工作台预览需要在桌面和窄屏都完整看见画布内容，所以由这里显式调用同一套 ViewService。
   */
  function fitPreview(): void {
    if (!ready.value || !host.value) return
    host.value.view.fitView(0.14)
    burstRedraw()
  }

  /** 只有舞台尺寸真的变了才重新取景；编辑面板展开/指示线重绘不会打乱用户正在看的视角 */
  function fitOnStageResize(): void {
    const stage = stageEl.value
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const size = Math.round(rect.width) + 'x' + Math.round(rect.height)
    if (size === runtime.lastStageSize) return
    runtime.lastStageSize = size
    clearTimeout(runtime.fitTimer)
    runtime.fitTimer = window.setTimeout(fitPreview, 180)
  }

  /**
   * 场景的“布景”全部走真实服务：
   * - base：选中一条边，CustomEdge 才会跑流光；
   * - multi：选中两个真实节点，多选插件才会画内外框；
   * - align：清空选中（多选拖动不对齐），由回放拖一次节点；
   * - box/cut：清空选中，由回放生成真实绘制框 / 刀光。
   */
  function seekSceneSelection(id: ThemeLabScene): void {
    const h = host.value
    if (!h) return
    if (id === 'base') {
      h.selection.set([])
      h.selection.setEdges(['lab-edge'])
    } else if (id === 'multi') {
      h.selection.setEdges([])
      h.selection.set(['lab-text', 'lab-image'])
    } else {
      h.selection.clear()
    }
  }

  return { togglePlugin, sceneAvailableFor, selectScene, resetAllNodes, burstRedraw, fitPreview, fitOnStageResize, seekSceneSelection }
}
