/**
 * miniMapDock —— 小地图「跟着按钮走」的挂载点（宿主外壳 → 地图 Teleport 目标）。
 *
 * 问题（2026-10-28 用户实测）：小地图展开/折叠抽屉后要等 0.5~1 秒（兜底轮询 2 秒）
 * 才跳到正确位置；按钮自己的 CSS 动画很顺，地图却是「闪过去」。
 *
 * 根因：旧定位 = App.vue 读按钮 `getBoundingClientRect()` 再写地图 transform。
 * 抽屉开合是 CSS transform 动画 —— 尺寸不变，ResizeObserver / window resize
 * 都收不到；只能等 2 秒轮询重新读坐标。
 *
 * 修法：在按钮旁放一个零尺寸节点当 Teleport 目标，地图用 absolute 浮在它上方。
 * 地图与按钮共享同一条父级 transform 动画 —— 浏览器每帧一起移动，零延迟、零轮询。
 *
 * 为什么不用 `position: fixed` 挂 body：那样又回到「两个独立的屏幕坐标」，
 * 同样要读坐标才能跟上按钮，且会丢掉按钮容器的 CSS 变量（主题色）。
 *
 * 为什么不直接把地图 DOM 塞进 `<button>`：按钮是 28×28 的可点控件，
 * 塞进去会把 240×160 的地图算进点击/尺寸范围，破坏按钮语义与布局。
 */
import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/** 当前宿主提供的小地图挂点（Provider 在外壳最外层） */
export const MINI_MAP_DOCK_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol('mini-map-dock')

/** 外壳根（App.vue）：建一个可写的挂点 ref 并提供给后代 */
export function provideMiniMapDockTarget(): Ref<HTMLElement | null> {
  const target = ref<HTMLElement | null>(null)
  provide(MINI_MAP_DOCK_KEY, target)
  return target
}

/** 状态条按钮（StatusArea.vue）：取同一个挂点并绑定到零尺寸 span */
export function useMiniMapDockTarget(): Ref<HTMLElement | null> {
  return inject(MINI_MAP_DOCK_KEY, ref<HTMLElement | null>(null))
}
