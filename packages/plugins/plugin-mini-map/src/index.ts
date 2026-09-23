// plugin-mini-map —— 小地图插件（Ctrl/Cmd+M 切换显隐；缩略图 + 视口矩形 + 拖拽平移/点击跳转；
// 定位归宿主：经 <SlotHost slot="mini-map"/> 渲染，显隐经 ctx.get('mini-map').visible 统一控制）。
export { miniMapPlugin, name, apply } from './miniMapPlugin'
export { Config } from './miniMapPlugin'
export type { MiniMapConfig } from './miniMapConfig'
export {
  type MiniMapRect,
  type MiniMapViewport,
  type MiniMapMapState,
  computeContentBounds,
  unionRect,
  viewportRectInFlow,
  computeMapState,
  rectToMap,
  panViewport,
  mapPointToFlow,
} from './miniMapEngine'
