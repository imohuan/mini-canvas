/**
 * ui-mini-map —— 成品应用的小地图"挂载位"插件（专用槽 mini-map 的宿主侧渲染器）。
 *
 * 两个槽各管一件事（避免自渲染递归）：
 *   plugin-mini-map 负责"画一张小地图"（数据/手势/配色，组件不自带定位）；
 *   本插件负责"它显示在哪 + 跟谁对齐"：往专用槽 ui-mini-map 注册一个零样式定位容器，
 *   容器内部渲染 <SlotHost slot="mini-map"/>（真正的地图），并包在按钮屏幕矩形正上方随按钮移动。
 *
 * 跟随用 JS 每帧测（rAF）：状态栏按钮在抽屉开合时走 transform 过渡（getBoundingClientRect
 * 每帧都变，一次测量 + transitionend 会落后），逐帧读矩形再差量写 transform，动画中始终贴合。
 * 容器本身 position:fixed 且无 transform 基准问题：每次移动都把增量写进自身 transform，无累积。
 */
import type { Context, PluginModule } from '@mini-canvas/kernel'
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { SlotHost } from '@mini-canvas/canvas-render'

const name = 'ui-mini-map'

/** 目标按钮（状态栏「切换小地图」）的 aria-label —— 按钮挪窝只需改这一行 */
const ANCHOR_LABEL = '切换小地图'

const UiMiniMapAnchor = defineComponent({
  name: 'UiMiniMapAnchor',
  setup() {
    const el = ref<HTMLElement | null>(null)
    const x = ref(0)
    const y = ref(0)
    const placed = ref(false)
    let raf = 0
    let lastRect: DOMRect | null = null

    function tick(): void {
      raf = 0
      const root = el.value
      if (!root) return
      const anchor = document.querySelector(`button[aria-label="${ANCHOR_LABEL}"]`)
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      if (r.width <= 0 && r.height <= 0) return
      if (lastRect) {
        x.value += r.left - lastRect.left
        y.value += r.top - lastRect.top
      } else {
        // 首帧摆位：水平中心对齐按钮中心，底边贴按钮顶边往上 8px
        x.value = r.left + r.width / 2
        y.value = r.top - 8
      }
      lastRect = r
      placed.value = true
      // 让 occupant 底部中心 = 锚点(y, x)：先平移容器中心到锚点，再左/上移自身尺寸的一半
      const w = root.offsetWidth
      const hgt = root.offsetHeight
      root.style.transform = `translate(${x.value - w / 2}px, ${y.value - hgt}px)`
    }

    function loop(): void {
      if (raf) return
      raf = requestAnimationFrame(tick)
    }

    onMounted(() => {
      loop()
      window.addEventListener('resize', loop, { passive: true })
      window.addEventListener('scroll', loop, { passive: true, capture: true })
    })
    onBeforeUnmount(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    })

    return () =>
      h(
        'div',
        {
          ref: el,
          // 固定悬浮在画布之上；自身不挡事件（真正的可点区域 = 里面的地图盒子）
          style: {
            position: 'fixed',
            left: '0',
            top: '0',
            zIndex: '25',
            pointerEvents: 'none',
            visibility: placed.value ? 'visible' : 'hidden',
          },
        },
        [
          h(
            'div',
            { style: { pointerEvents: 'auto' } },
            [h(SlotHost, { slot: 'mini-map' })],
          ),
        ],
      )
  },
})

export const uiMiniMapPanelPlugin: PluginModule = {
  name,
  apply(ctx: Context) {
    // App.vue 渲染 <SlotHost slot="ui-mini-map"/>；本 occupant 内部再渲染 mini-map 专用槽。
    ctx.slots.register('ui-mini-map', {
      id: name,
      order: 0,
      component: UiMiniMapAnchor,
      meta: { title: '小地图挂载位' },
    })
  },
}
