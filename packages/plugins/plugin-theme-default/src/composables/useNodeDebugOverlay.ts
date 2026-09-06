/**
 * useNodeDebugOverlay —— 吸附调试(connectionSnapDebugVisible)的**目标节点吸附带/接收区**几何（纯计算）。
 *
 * v2 复刻 v1 Decoration/BaseNode 的 target zone 调试可视化，但改用 **SVG 在卡内坐标画**（v1 是 clip-path div，
 * 效果差）。数据源与 canvas-render resolveFeedback 完全同源：DEFAULT_SNAP_RATIOS + handleParams.handleRadius，
 * 保证调试画出来的带就是真实吸附判定用的带。
 *
 * 几何（卡内本地坐标，卡宽=cardWidth、卡高=cardHeight）：
 *   - 端口锚点：target 口 = 卡左缘中点 (0, cardHeight/2)。
 *   - 吸附带竖条：以锚点为中心，x 从 -snapOuter 到 +snapInner（向左外扩 snapOuter、向右内扩 snapInner，
 *     可出卡片负 x，交给 overflow:visible 的 SVG 画），y 高 = handleRadius*heightRatio，居中于锚点 y。
 *   - body 接收区：整张卡。
 *
 * 仅 forward(拖 source→找 target) 有意义时给 target 节点画（调用方用 isConnecting+非源自身+hasTarget 判断）。
 */
import { computed, type Ref } from 'vue'
import { DEFAULT_SNAP_RATIOS } from '@mini-canvas/canvas-render'

export interface SnapBandRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NodeDebugOverlayGeometry {
  /** 卡片左缘中点（target 锚点） */
  anchorY: number
  /** 吸附带矩形（卡内本地坐标，可为负 x） */
  band: SnapBandRect
}

export function useNodeDebugOverlay(opts: {
  cardWidth: Ref<number>
  cardHeight: Ref<number>
  handleRadius: Ref<number>
}) {
  // 吸附带尺寸：与 canvas-render resolveFeedback 一致（DEFAULT_SNAP_RATIOS.outer/inner/height × handleRadius）
  const snapOuter = computed(() => opts.handleRadius.value * DEFAULT_SNAP_RATIOS.outer)
  const snapInner = computed(() => opts.handleRadius.value * DEFAULT_SNAP_RATIOS.inner)
  const snapHeight = computed(() => opts.handleRadius.value * DEFAULT_SNAP_RATIOS.height)

  const anchorY = computed(() => opts.cardHeight.value / 2)

  const band = computed<SnapBandRect>(() => ({
    x: -snapOuter.value,
    y: anchorY.value - snapHeight.value / 2,
    width: snapOuter.value + snapInner.value,
    height: snapHeight.value,
  }))

  return { anchorY, band }
}
