/**
 * barTypes —— 底栏动作类型（转发 @plume-canvas/canvas-data）。
 *
 * 类型本体住在引擎 canvas-data：别的插件只依赖上游引擎就能取到动作形状，
 * 不需要 import 本插件。这里保留同名导出，包内组件与既有测试继续按原路径引用。
 */
export type {
  BarAction,
  BarApplier,
  BarRunContext,
  BarRunInput,
} from '@plume-canvas/canvas-data'

import type { BarAction, BarApplier } from '@plume-canvas/canvas-data'

/** 动作执行的只读查找口（taskRuntime 不关心注册方式，只要能查） */
export interface BarLookup {
  get(id: string): BarAction | undefined
  applierOf(kind: string): BarApplier | undefined
}
