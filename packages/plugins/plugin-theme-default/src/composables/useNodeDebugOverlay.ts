/**
 * useNodeDebugOverlay —— 吸附调试(connectionSnapDebugVisible)的目标节点**双侧**吸附带几何（纯计算）。
 *
 * 数据源与 canvas-render resolveFeedback **同源**：统一走 SnapZoneConfig(heightRatio/width/offset/shape) +
 * handleRadius 兜底宽（**仅当 width 缺省**；显式给 0 就是 0，不兜底），保证调试画出来的带就是真实吸附判定用的带。
 *
 * 几何（卡内本地坐标，卡宽=cardWidth、卡高=cardHeight）：
 *   - 端口锚点：target 输入口 = 卡左缘中点 (0, cardHeight/2)；source 输出口 = 卡右缘中点 (cardWidth, cardHeight/2)。
 *   - 吸附带竖条高 = min(卡高, 卡高×heightRatio)，居中于锚点 y；宽 = width（缺省才回落到 handleRadius）。
 *   - left(target 左缘)：带从锚点向左侧伸 width，x = -(width-offset)
 *   - right(source 右缘)：带从锚点向右侧伸 width，x = cardWidth-offset
 *   - shape：rect(矩形)/arc(半椭圆弧，圆心在端口锚点)。命中一律按矩形，shape 仅影响视觉。
 */
import { computed, type Ref } from "vue";
import {
  computeSideBandRect,
  type SnapZoneConfig,
  type SnapZoneShape,
} from "@mini-canvas/canvas-render";

export interface SnapBandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 端口侧（供模板区分 rect/arc 与左右） */
export type DebugBandSide = "target" | "source";

export interface NodeDebugOverlayGeometry {
  /** 端口锚点 y（左右共用，居中于卡高） */
  anchorY: number;
  /** 吸附带形状 */
  shape: SnapZoneShape;
  /** 左侧 target 输入口吸附带（卡内本地坐标，可为负 x 由 SVG overflow:visible 画出去） */
  leftBand: SnapBandRect;
  /** 右侧 source 输出口吸附带 */
  rightBand: SnapBandRect;
}

export function useNodeDebugOverlay(opts: {
  cardWidth: Ref<number>;
  cardHeight: Ref<number>;
  handleRadius: Ref<number>;
  snapZone: SnapZoneConfig;
}) {
  const heightRatio = computed(() =>
    Math.min(Math.max(opts.snapZone.heightRatio || 0.8, 0), 1),
  );
  const width = computed(() => opts.snapZone.width ?? opts.handleRadius.value);
  const offset = computed(() => opts.snapZone.offset ?? 0);
  const shape = computed<SnapZoneShape>(() => opts.snapZone.shape ?? "rect");

  const anchorY = computed(() => opts.cardHeight.value / 2);
  const bandHeight = computed(() => opts.cardHeight.value * heightRatio.value);
  const bandY = computed(() => anchorY.value - bandHeight.value / 2);

  /** target(左缘)带：锚点 x=0，向外(左)伸 width → x = -(width-offset) */
  const localRect = computed(() => ({
    id: "__node__",
    x: 0,
    y: 0,
    width: opts.cardWidth.value,
    height: opts.cardHeight.value,
  }));
  const sharedConfig = computed<SnapZoneConfig>(() => ({
    heightRatio: heightRatio.value,
    width: width.value,
    offset: offset.value,
    shape: shape.value,
  }));
  const leftBand = computed<SnapBandRect>(() =>
    computeSideBandRect(
      localRect.value,
      "target",
      opts.handleRadius.value,
      sharedConfig.value,
    ),
  );
  /** source(右缘)带：锚点 x=cardWidth，向外(右)伸 width → x = cardWidth - offset */
  const rightBand = computed<SnapBandRect>(() =>
    computeSideBandRect(
      localRect.value,
      "source",
      opts.handleRadius.value,
      sharedConfig.value,
    ),
  );

  return { anchorY, shape, leftBand, rightBand };
}
