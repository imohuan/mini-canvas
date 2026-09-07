// plugin-mini-map —— 小地图插件（Ctrl/Cmd+M 切换显隐；右下角缩略 + 视口矩形 + 拖拽平移/点击跳转）。
export { miniMapPlugin, name, apply } from './miniMapPlugin'
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
