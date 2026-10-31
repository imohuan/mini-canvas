/**
 * 画布开关按钮的整装验证（状态栏 / 底栏那排按钮真的接上了内核）。
 *
 * 用户报的现象：左下角「整理画布 / 小地图 / 隐藏节点连线 / 网格吸附」与底栏「移动 / 抓手」
 * 点了**只有图标变化、画布毫无反应**。根因是这些按钮当时只改了 useUi 里的本地状态，
 * 没有任何一处写到内核（设置面板改同一件事却真的生效）。
 *
 * 所以这条测试不测组件渲染，而是测**装配后的接线**：按钮入口（ui.toggleEdges 等）与
 * 设置面板用的是不是同一个键、写下去消费方读不读得到。用真实内核 + 真实插件跑一遍 ——
 * 少接一根线（键名写错、没订阅、没声明）这里就会红。
 *
 * 放在 ui 包：只有装配层能同时拿到宿主（createMiniCanvasHost）+ 插件 + useUi 单例。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter, type Context } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { setReadyHost, useUi } from '../composables/ui'

/** 与成品清单同形的宿主：装默认皮（edgeVisible）+ 小地图 + 自动布局（整理画布命令） */
async function boot() {
  const { host } = await createMiniCanvasHost({
    adapter: new MemoryStorageAdapter(),
    coldPlugins: [themeDefaultPlugin, nodeTextPlugin, miniMapPlugin, autoLayoutPlugin],
  })
  return host
}

/** 读内核设置现值（断言用） */
function setting(ctx: Context, key: string): string | number | boolean {
  return ctx.get<{ get(k: string): string | number | boolean }>('settings').get(key)
}

describe('画布开关按钮接上内核（状态栏 / 底栏）', () => {
  let host: Awaited<ReturnType<typeof boot>>
  const ui = useUi()
  const s = ui.state

  beforeEach(async () => {
    host = await boot()
    ui.setHostEl({ host })
    // 小地图开关读的是 readyHost（与 App.vue 的 @ready 同一条路），这里一并接上
    setReadyHost(host)
    await ui.onReady()
  })

  afterEach(() => {
    // 先把订阅撤掉（否则下一个用例再 onReady 时回调会堆积到已停的宿主上）
    ui.unbindCanvasToggles()
    ui.unbindThemeMode()
    host.stop()
  })

  it('隐藏节点连线：写设置 edgeVisible（与设置面板「显示连线」同一个键）', () => {
    expect(setting(host.ctx, 'edgeVisible')).toBe(true)

    ui.toggleEdges()
    expect(setting(host.ctx, 'edgeVisible')).toBe(false)
    expect(s.edgesVisible).toBe(false)

    ui.toggleEdges()
    expect(setting(host.ctx, 'edgeVisible')).toBe(true)
    expect(s.edgesVisible).toBe(true)
  })

  it('网格吸附：写设置 snapToGrid（与设置面板「网格吸附」同一个键）', () => {
    // 宿主默认关（CANVAS_INTERACTION_DEFAULTS.snapToGrid = false），onReady 已把镜像值对齐过来
    expect(setting(host.ctx, 'snapToGrid')).toBe(false)
    expect(s.snapOn).toBe(false)

    ui.toggleSnap()
    expect(setting(host.ctx, 'snapToGrid')).toBe(true)
    expect(s.snapOn).toBe(true)

    ui.toggleSnap()
    expect(setting(host.ctx, 'snapToGrid')).toBe(false)
    expect(s.snapOn).toBe(false)
  })

  it('移动 / 抓手：切换 nodesDraggable（抓手态 = 拖哪都平移画布，节点不被拖走）', () => {
    expect(setting(host.ctx, 'nodesDraggable')).toBe(true)
    expect(setting(host.ctx, 'panOnDrag')).toBe(true)

    ui.setCanvasMode('hand')
    expect(s.canvasMode).toBe('hand')
    expect(setting(host.ctx, 'nodesDraggable')).toBe(false)
    expect(setting(host.ctx, 'panOnDrag')).toBe(true) // 抓手必须能拖动画布

    ui.setCanvasMode('move')
    expect(s.canvasMode).toBe('move')
    expect(setting(host.ctx, 'nodesDraggable')).toBe(true)
    expect(setting(host.ctx, 'panOnDrag')).toBe(true)
  })

  it('小地图开关：写设置 miniMapVisible（且随配置持久化，能被插件服务读到）', () => {
    expect(setting(host.ctx, 'miniMapVisible')).toBe(true)
    expect(ui.minimapOn.value).toBe(true)

    ui.toggleMinimap()
    expect(setting(host.ctx, 'miniMapVisible')).toBe(false)
    // 插件订阅 settings → 服务状态跟着变（miniMapOn 读的就是它）
    expect(ui.minimapOn.value).toBe(false)

    ui.toggleMinimap()
    expect(setting(host.ctx, 'miniMapVisible')).toBe(true)
    expect(ui.minimapOn.value).toBe(true)
  })

  it('小地图按钮初始值跟设置一致：设置读不到时按显示处理（与插件默认 true 对齐）', () => {
    // 模拟“声明了但值没写进去”：SettingsStore.get 返回 undefined。
    // 旧实现 === true 会把按钮判成“关”，与浮层（默认显示）相反。
    const store = host.ctx.get<{ get(k: string): unknown }>('settings')
    const spy = vi.spyOn(store, 'get').mockReturnValue(undefined)
    ui.unbindCanvasToggles()
    ui.onReady()
    expect(ui.minimapOn.value).toBe(true)
    spy.mockRestore()
    ui.unbindCanvasToggles()
    ui.onReady()
  })

  it('整理画布：真的执行自动布局命令（节点位置被写回 doc）', () => {
    const doc = host.ctx.get<{
      addNodes(n: unknown[]): void
      getNodes(): Array<{ id: string; position: { x: number; y: number } }>
    }>('doc')
    doc.addNodes([
      { type: 'text', position: { x: 500, y: 500 } },
      { type: 'text', position: { x: 500, y: 500 } },
    ])
    const before = doc.getNodes().map((n) => `${n.position.x},${n.position.y}`)

    ui.organizeCanvas()

    const after = doc.getNodes().map((n) => `${n.position.x},${n.position.y}`)
    // 布局会重新排布节点 → 位置串必然变化（命令真跑了；没跑就是完全一致）
    expect(after).not.toEqual(before)
  })

  it('设置面板改键，按钮镜像值跟着变（不出现"面板关了按钮还亮着"的假状态）', () => {
    const store = host.ctx.get<{ set(k: string, v: string | number | boolean): boolean }>('settings')

    store.set('edgeVisible', false)
    expect(s.edgesVisible).toBe(false)

    store.set('snapToGrid', true)
    expect(s.snapOn).toBe(true)

    store.set('nodesDraggable', false)
    expect(s.canvasMode).toBe('hand')
  })

  it('主题模式：右上角调色板切主题写进 settings（themeMode），刷新才能记住', () => {
    const store = host.ctx.get<{ get(k: string): unknown; set(k: string, v: string | number | boolean): boolean }>(
      'settings',
    )
    // 宿主默认暗色（对齐 index.html 首屏 class="dark"）
    expect(store.get('themeMode')).toBe('dark')
    expect(s.theme).toBe('dark')

    ui.toggleTheme()
    expect(store.get('themeMode')).toBe('light') // 写内核设置 = 可持久化
    expect(s.theme).toBe('light')

    // 设置面板里改同一项，按钮镜像值也跟着变
    store.set('themeMode', 'dark')
    expect(s.theme).toBe('dark')
  })
})

/**
 * 左下角「缩放选项」接上真实画布（用户要求）。
 *
 * 盯住的缺陷：这里的百分比与菜单动作原先只是**纯 UI 数字**（`state.zoom = 39` 写死），从没接到
 * viewport 上 —— 表现为"点缩放至 100% 画布纹丝不动、读数也永远是 39%"。现在百分比是真实视口的镜像，
 * 菜单动作调 viewport 服务改真画布。
 *
 * 用假 viewport 替换宿主那个（真后端要挂载 VueFlow，node 环境给不了），只验接线。
 */
describe('缩放选项接上真实画布（状态栏）', () => {
  const ui = useUi()
  const s = ui.state
  let host: Awaited<ReturnType<typeof boot>>
  let fake: ReturnType<typeof makeFakeViewport>

  beforeEach(async () => {
    host = await boot()
    fake = makeFakeViewport()
    ui.setHostEl({ host })
    setReadyHost(host)
    await ui.onReady()
    // 给真实 viewport 服务换上假后端（真后端要挂载 VueFlow，node 环境给不了）；
    // 服务实例本身仍是宿主注入的那个，兑现"ui 走 ctx.get('view')"这条真实路径。
    ;(host.ctx.get('view') as unknown as { attachBackend(b: unknown): void }).attachBackend(fake)
  })

  afterEach(() => {
    ui.unbindCanvasToggles()
    ui.unbindZoomSync()
    host.stop()
  })

  it('「缩放至 50% / 100%」真的调 viewport.zoomTo（不再只改数字）', () => {
    ui.zoomToPercent(50)
    expect(fake.state.zoom).toBe(0.5)
    expect(fake.calls).toContain('zoomTo:0.5')

    ui.zoomToPercent(100)
    expect(fake.state.zoom).toBe(1)
    expect(fake.calls).toContain('zoomTo:1')
  })

  it('放大 / 缩小以真实视口为基准 ±10%，并钳在 10%–800%', () => {
    fake.state.zoom = 0.5
    ui.zoomInStep()
    expect(fake.state.zoom).toBeCloseTo(0.6, 5)
    ui.zoomOutStep()
    expect(fake.state.zoom).toBeCloseTo(0.5, 5)

    fake.state.zoom = 8 // 已在 800% 上限
    ui.zoomInStep()
    expect(fake.state.zoom).toBe(8)
    fake.state.zoom = 0.1 // 已在 10% 下限
    ui.zoomOutStep()
    expect(fake.state.zoom).toBe(0.1)
  })

  it('「适合屏幕」真的调 viewport.fitView（不再是假动作）', () => {
    ui.zoomFit()
    expect(fake.calls).toContain('fitView')
  })

  it('「缩放到最大」按设置 maxZoom 走（默认 300%），不写死 800%', () => {
    // 默认宿主声明里 maxZoom=3（300%）：点"缩放到最大"应真的到 3.0，而不是一个够不到的 8
    ui.zoomToMax()
    expect(fake.state.zoom).toBe(3)
    expect(fake.calls).toContain('zoomTo:3')

    // 用户在设置面板把上限调高到 8 → 同一个按钮就走到 800%
    host.ctx.get<{ set(k: string, v: string | number | boolean): boolean }>('settings').set('maxZoom', 8)
    ui.zoomToMax()
    expect(fake.state.zoom).toBe(8)
    expect(fake.calls).toContain('zoomTo:8')
  })

  it('读数镜像真实视口（不是写死的 39）', () => {
    // 生产环境靠常驻 rAF 逐帧比对真实 zoom（程序化缩放不发 move 事件，实测）；node 环境没有 rAF，
    // 这里直接调同步函数，验的就是"读数取自真实 viewport"这条语义。
    fake.state.zoom = 1.6
    ui.syncZoomDisplay()
    expect(s.zoom).toBe(160)

    fake.state.zoom = 0.39
    ui.syncZoomDisplay()
    expect(s.zoom).toBe(39)
  })
})

/** 假 viewport：只记录调用 + 维护一个 zoom（真后端要挂载 VueFlow，node 环境没有） */
function makeFakeViewport() {
  const state = { x: 0, y: 0, zoom: 1 }
  const calls: string[] = []
  return {
    state,
    calls,
    getViewport: () => ({ ...state }),
    setViewport: (v: { x: number; y: number; zoom: number }) => Object.assign(state, v),
    zoomIn: () => { calls.push('zoomIn'); state.zoom = Math.min(8, state.zoom * 1.1) },
    zoomOut: () => { calls.push('zoomOut'); state.zoom = Math.max(0.1, state.zoom / 1.1) },
    zoomTo: (level: number) => { calls.push('zoomTo:' + level); state.zoom = level },
    fitView: () => { calls.push('fitView'); state.zoom = 0.6 },
  }
}
