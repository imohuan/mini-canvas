/**
 * canvasParamKey —— 宿主画布外观参数（供 BaseNode/端口等读取、由宿主设置面板实时修改）的注入令牌。
 *
 * BaseNode 等壳组件经此读取响应式外观参数(如浮动端口尺寸)；宿主不注入则回落到 contract §0 默认值。
 * 注入值须为响应式(reactive)对象：其属性改动会被消费方 computed 追踪而实时生效。
 */
import type { InjectionKey } from 'vue'

/** BaseNode/端口外观参数（默认值对齐 core-node-contract §0） */
export interface CanvasParams {
  /** 浮动端口半径 px（handleRadius=86） */
  handleRadius: number
  /** 圆球离区归位偏移 px（handleRestOffset=36） */
  handleRestOffset: number
  /** 圆球跟鼠标错开 px（handleCursorGap=24） */
  handleCursorGap: number
  /** 圆球尺寸 px（handleButtonSize=32） */
  handleButtonSize: number
  /** 半圆向节点内侧裁剪 px（handleOverlap=16） */
  handleOverlap: number
  /** 端口区域宽度；缺省沿用 handleRadius。 */
  portZoneWidth?: number
  /** 端口区域高度占节点高度比例；缺省 0.8。 */
  portZoneHeightRatio?: number
  /** 端口区域相对锚点偏移；语义与吸附带 offset 一致。 */
  portZoneOffset?: number
  /** 端口区域形状；rect 或 arc。 */
  portZoneShape?: 'rect' | 'arc'
  /** 端口弧垂直胖瘦系数(0~1)：1=锚点圆心半椭圆(与吸附带同款)，越小越扁接近平顶。缺省 1。 */
  portZoneArcRatio?: number
}

export const CANVAS_PARAMS_KEY: InjectionKey<CanvasParams> = Symbol('canvas-v2-canvas-params')
