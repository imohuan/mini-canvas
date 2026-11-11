import { computed, ref } from 'vue'
import type { SettingsStore } from '@plume-canvas/kernel'
import { readyHost } from './hostRuntime'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'

/**
 * 画布开关：小地图、连线显隐、网格吸附、移动/抓手。
 *
 * 所有按钮只写内核设置（不存本地副本）；订阅/store 对齐的时机与原实现一致。
 */
export function createCanvasTogglesScope(state: UiState, host: UiHostScope) {
  const { hostCtx, readSetting, writeSetting, runCommand } = host

  // ===== 小地图显隐（唯一事实来源 = 设置项 miniMapVisible；状态栏按钮只是它的开关） =====
  // 插件浮层与命令订阅同一设置项（SettingsStore 是单一数据源），这里不再读私有服务。
  // SettingsStore 不是响应式的：bindCanvasToggles 里订阅 onChange 同步到这个 ref。
  const minimapVisible = ref(false)
  const minimapOn = computed(() => minimapVisible.value)
  function toggleMinimap(): void {
    const store = readyHost?.ctx?.get<SettingsStore>('settings')
    if (!store?.has?.('miniMapVisible')) return
    store.set('miniMapVisible', !minimapOn.value)
  }

  /**
   * 连线显隐：写设置 edgeVisible（分组「边/连线」，默认皮 CustomEdge 订阅它决定画不画）。
   * 与设置面板里那个「显示连线」开关是**同一个键** —— 在哪边改，另一边立刻一致。
   */
  function toggleEdges(): void {
    const next = !state.edgesVisible
    writeSetting('edgeVisible', next)
    state.edgesVisible = readSetting<boolean>('edgeVisible') ?? next
  }

  /**
   * 网格吸附：写设置 snapToGrid（分组「常规/画布」，渲染宿主 CanvasHost 订阅后绑给 VueFlow）。
   * 吸附间距 snapGridX/Y 由同一个设置面板调，按钮只管开关。
   */
  function toggleSnap(): void {
    const next = !state.snapOn
    writeSetting('snapToGrid', next)
    state.snapOn = readSetting<boolean>('snapToGrid') ?? next
  }

  /**
   * 整理画布：执行 auto-layout 插件的自动布局命令（Ctrl/Cmd+L 同一条命令）。
   * 走命令而非自写布局：结果一次写进 doc（含历史与落盘），撤销/重做与快捷键行为完全一致。
   */
  function organizeCanvas(): void {
    runCommand('auto-layout:run')
  }

  /**
   * 切换画布鼠标工具（移动 / 抓手）。两个模式各写两个宿主级设置键：
   *
   * - 移动 move：`nodesDraggable=true` + `panOnDrag=true` → 拖节点移动节点、拖空白平移画布（默认态）。
   * - 抓手 hand：`nodesDraggable=false` + `panOnDrag=true` → 拖任何地方都是平移画布，
   *   节点不会被拖走（真正的"抓手"；再点移动即恢复）。
   *
   * 为什么用设置而不是自己存一份：这两个键（分组「常规/画布」）由渲染宿主订阅后绑给 VueFlow，
   * 写设置就等于真的改了画布交互；用户若在设置面板里手动开关这两项，模式按钮的状态也跟着翻。
   * 光标不用手写：panOnDrag 开着时 VueFlow 给画布层加 `draggable` → grab / grabbing（见其 style.css）。
   */
  function setCanvasMode(mode: 'move' | 'hand'): void {
    state.canvasMode = mode
    writeSetting('panOnDrag', true)
    writeSetting('nodesDraggable', mode === 'move')
  }

  /**
   * 订阅宿主设置变化，把「按钮关心的那几个键」同步到本地镜像值。
   *
   * 为什么必须订阅：设置面板改 edgeVisible / snapToGrid 时，状态栏图标的亮/暗与斜线
   * 也要跟着变；不订阅就会出现"面板关了、按钮还亮着"的假状态（本文件里 themePalette /
   * mini-map 也是同款做法）。重复 onReady 时先撤旧订阅，避免回调堆积。
   */
  let disposeCanvasToggleBind: (() => void) | undefined
  let disposeCanvasToggleSchema: (() => void) | undefined
  /**
   * 按设置现值对齐一次镜像（缺省值规则与首次绑定一致）。
   *
   * 为什么单独抽出来：插件是**可以后装的**（设置 → 插件 → 安装）。安装时才 define
   * `miniMapVisible` 这些项，而 `SettingsStore.define` 只通知 schema 变化、**不发 onChange**。
   * 只订阅 onChange 的话：onReady 时没人声明 → 镜像兜底 true；插件装好后设置里其实是
   * 用户存的 false，镜像却仍是 true。点按钮写回同一个 false，`set` 返回 false 也不通知，
   * 图标和地图从此卡死在「开」（用户报障：两个图标没有切换效果）。
   */
  function syncCanvasTogglesFromSettings(store: SettingsStore): void {
    state.edgesVisible = (store.get('edgeVisible') as boolean | undefined) ?? state.edgesVisible
    state.snapOn = (store.get('snapToGrid') as boolean | undefined) ?? state.snapOn
    // 未赋值时 SettingsStore 返回 undefined（不是 schema 默认值）；旧实现读插件服务的
    // 初始 visible（默认 true）。这里缺省按“显示”处理，避免状态栏图标与浮层不一致。
    minimapVisible.value = store.get('miniMapVisible') !== false
    // 画布模式由 nodesDraggable 反推：关掉拖节点 = 抓手态（拖哪都平移画布），否则是移动态
    const draggable = store.get('nodesDraggable') as boolean | undefined
    if (typeof draggable === 'boolean') state.canvasMode = draggable ? 'move' : 'hand'
  }

  function bindCanvasToggles(): void {
    disposeCanvasToggleBind?.()
    disposeCanvasToggleBind = undefined
    disposeCanvasToggleSchema?.()
    disposeCanvasToggleSchema = undefined
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store) return
    // 先按现值对齐一次（面板之前可能已经改过）
    syncCanvasTogglesFromSettings(store)
    disposeCanvasToggleBind = store.onChange((key, value) => {
      if (key === 'edgeVisible' && typeof value === 'boolean') state.edgesVisible = value
      else if (key === 'snapToGrid' && typeof value === 'boolean') state.snapOn = value
      else if (key === 'nodesDraggable' && typeof value === 'boolean') state.canvasMode = value ? 'move' : 'hand'
      else if (key === 'miniMapVisible' && typeof value === 'boolean') minimapVisible.value = value
    }).dispose
    // 后装/热卸插件会**晚于 onReady** 申报或回收这些键：schema 变化时重读一遍现值。
    disposeCanvasToggleSchema = store.onSchemaChange(() => syncCanvasTogglesFromSettings(store)).dispose
  }

  /** 撤掉画布开关的设置订阅（宿主销毁时调用，与 unbindSettingsClose 同处） */
  function unbindCanvasToggles(): void {
    disposeCanvasToggleBind?.()
    disposeCanvasToggleBind = undefined
    disposeCanvasToggleSchema?.()
    disposeCanvasToggleSchema = undefined
  }

  return {
    minimapVisible, minimapOn, toggleMinimap,
    toggleEdges, toggleSnap, organizeCanvas, setCanvasMode, bindCanvasToggles, unbindCanvasToggles,
  }
}

export type CanvasTogglesScope = ReturnType<typeof createCanvasTogglesScope>

