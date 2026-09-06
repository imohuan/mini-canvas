/**
 * contracts/debugContext.ts —— 画布"调试可视化"开关（端口调试 handleDebug / 吸附调试 connectionSnapDebugVisible）。
 *
 * v2 复刻 v1 Canvas.vue:562-563 的两个调试开关，语义对齐 v1：
 *   - handleDebug：打开后 MovingHandle(端口) 画出半圆 zone / 圆心 / rest 默认点 / 当前鼠标点。
 *   - connectionSnapDebugVisible：打开后，拖线悬停到某节点时把它的吸附带 + body 反馈区画出来。
 *
 * 注：不塞进 CanvasParams(端口尺寸)，因那对象有"5 字段"合同(单测锁长度)；调试开关是独立的布尔组，
 * 走与 handleVisual/edgeVisual 完全一致的"宿主 prop reactive 对象 → provide → 组件消费"链路。
 */
import type { InjectionKey } from 'vue'

/** 调试可视化开关（宿主注入的响应式对象；属性改即实时生效） */
export interface CanvasDebug {
  /** 端口调试：画出端口半圆交互区/圆心/rest/鼠标点 */
  handleDebug: boolean
  /** 吸附调试：拖线时画出目标节点吸附带与 body 反馈区 */
  connectionSnapDebugVisible: boolean
}

export const DEBUG_KEY: InjectionKey<CanvasDebug> = Symbol('canvas-v2-debug-visual')
