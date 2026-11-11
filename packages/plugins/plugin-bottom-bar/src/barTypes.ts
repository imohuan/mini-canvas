/**
 * barTypes —— 底栏动作类型（转发 @plume-canvas/bar-contract）。
 *
 * 类型本体已抽到契约包：别的插件发布底栏动作时只依赖契约，不再依赖本插件。
 * 这里保留同名导出，包内组件与既有测试继续按原路径引用。
 */
export type {
  BarAction,
  BarApplier,
  BarRunContext,
  BarRunInput,
} from '@plume-canvas/bar-contract'

import type { BarAction, BarApplier } from '@plume-canvas/bar-contract'

/** 动作执行的只读查找口（taskRuntime 不关心注册方式，只要能查） */
export interface BarLookup {
  get(id: string): BarAction | undefined
  applierOf(kind: string): BarApplier | undefined
}
