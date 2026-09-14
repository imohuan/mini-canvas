/**
 * panoramaView —— 3D 全景预览的"视角数学"（纯逻辑、零 three.js、零 DOM、Node 可单测）。
 *
 * 为什么单独立一个文件：全景的交互本体（拖拽转向、滚轮缩放、平滑跟随、朝向→球面坐标）
 * 全是可计算的纯函数，把它们从 .vue/three.js 里剥出来后，就不必起 WebGL 也能锁住行为。
 * 组件只负责"把事件喂进来、把结果交给相机"。
 *
 * 坐标系与老版 PanoramaNode 保持一致（lon=经度/左右转，lat=纬度/上下看，fov=视野角）：
 * - lon 不设限，可以一直左右绕圈；
 * - lat 夹在 ±85°，避免视线在极点处翻转；
 * - fov 夹在 25~90°，防止缩到穿模或放到畸变。
 */

/** 视角状态：朝向（经/纬度，单位度）+ 视野角（度） */
export interface ViewState {
  /** 经度（左右转向，度；可无限累加绕圈） */
  lon: number
  /** 纬度（上下看的俯仰，度；被夹在 ±LAT_LIMIT） */
  lat: number
  /** 视野角（相机 fov，度；被夹在 FOV_MIN~FOV_MAX） */
  fov: number
}

/** 纬度上下限（避开极点，防止画面在正上方/正下方翻转） */
export const LAT_LIMIT = 85
/** 视野角上下限（度）：太小会穿模，太大会桶形畸变 */
export const FOV_MIN = 25
export const FOV_MAX = 90
/** 每拖 1 像素转多少度 */
export const DRAG_SENSITIVITY = 0.12
/** 每滚 1 格滚轮改多少视野角（度） */
export const ZOOM_SENSITIVITY = 0.05
/** 初始视角：正前方、默认视野角 */
export const DEFAULT_VIEW: ViewState = { lon: 0, lat: 0, fov: 75 }

/** 把纬度夹到 ±LAT_LIMIT 内 */
export function clampLat(lat: number): number {
  return Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat))
}

/** 把视野角夹到 FOV_MIN~FOV_MAX 内 */
export function clampFov(fov: number): number {
  return Math.max(FOV_MIN, Math.min(FOV_MAX, fov))
}

/** 生成"回到初始视角"的状态（重置按钮用） */
export function resetView(): ViewState {
  return { ...DEFAULT_VIEW }
}

/**
 * 按拖拽位移算出新视角（横向改经度、纵向改纬度）。
 * 经纬度是相对当前值累加的增量，因此调用方每次传"本次拖拽相对按下点的位移"即可。
 */
export function applyDrag(view: ViewState, dx: number, dy: number): ViewState {
  return {
    lon: view.lon + dx * DRAG_SENSITIVITY,
    lat: clampLat(view.lat + dy * DRAG_SENSITIVITY),
    fov: view.fov,
  }
}

/** 按滚轮位移算出新视野角（向下滚放大视野=画面缩小，与老版一致） */
export function applyZoom(view: ViewState, deltaY: number): ViewState {
  return { ...view, fov: clampFov(view.fov + deltaY * ZOOM_SENSITIVITY) }
}

/**
 * 指数平滑：把 current 朝 target 推近 ratio 比例（0~1）。
 * 每帧调用即可让视角"跟着鼠标柔和地滑过去"，而不是硬切。
 */
export function damp(current: number, target: number, ratio: number): number {
  return current + (target - current) * ratio
}

/**
 * 视角 → 球面坐标（弧度）。
 * phi 从 +Y 轴量起（纬度 0 时 phi=90°=赤道方向），theta 绕着 Y 轴（经度方向）。
 * 与 three.js 的 Spherical 约定一致，组件直接把它交给 setFromSphericalCoords。
 */
export function toSpherical(lon: number, lat: number): { phi: number; theta: number } {
  const deg2rad = Math.PI / 180
  return { phi: (90 - lat) * deg2rad, theta: lon * deg2rad }
}
