/**
 * 小地图跟随按钮（2026-10-28 用户实测：展开/折叠抽屉后要等 0.5~1 秒才跳过去）。
 *
 * 根因：地图在画布 #ui 的 fixed 容器里，位置靠 JS 读按钮矩形再写 transform；
 * 抽屉是 CSS transform 动画，尺寸不变 → ResizeObserver 不触发 → 只能等 2 秒轮询。
 *
 * 契约：地图必须挂进按钮旁的托盘点（同一套 CSS 位移带着走），
 * 不再出现轮询 / 读坐标写用坐标的定位路径。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const app = readFileSync(fileURLToPath(new URL('../App.vue', import.meta.url)), 'utf8')
const status = readFileSync(fileURLToPath(new URL('../components/areas/StatusArea.vue', import.meta.url)), 'utf8')
const overlay = readFileSync(
  fileURLToPath(new URL('../../../plugins/plugin-mini-map/src/MiniMapOverlay.vue', import.meta.url)),
  'utf8',
)

describe('小地图跟随状态条按钮', () => {
  it('地图经 Teleport 挂到按钮旁的托盘点（同一条 CSS 动画带着走）', () => {
    expect(app).toContain('<Teleport')
    expect(app).toContain('SlotHost slot="mini-map"')
    expect(app).toContain('mini-map-dock-layer')
    expect(app).toContain('provideMiniMapDockTarget')
  })

  it('不再用定时器 / ResizeObserver 轮询按钮坐标', () => {
    expect(app).not.toContain('miniMapRetryTimer')
    expect(app).not.toContain('placeMiniMap')
    expect(app).not.toContain('button[aria-label="切换小地图"]')
  })

  it('状态条按钮里提供零尺寸挂点，且挂点不拦截点击', () => {
    expect(status).toContain('mini-map-dock')
    expect(status).toContain('useMiniMapDockTarget')
    // 挂点不能吃点击：它只是定位锚，按钮还要能点
    expect(status).toMatch(/class="mini-map-dock"[^>]*aria-hidden/)
  })

  it('暗色主题保留小地图面板圆角（与亮色一致，不再归零）', () => {
    const darkBlock = overlay.slice(overlay.indexOf('html.dark .mini-map-overlay'))
    expect(darkBlock).toMatch(/--mm-radius:\s*12px/)
  })
})
