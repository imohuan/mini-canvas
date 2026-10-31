/**
 * autoSaveEngine —— 兼容垫片：实现已收进 @mini-canvas/canvas-data 的 autoSave.ts。
 *
 * 保留本文件与同名导出，是为了让既有 import 路径和单测继续成立；
 * 新代码请直接用 canvas-data 的 createAutoSaveEngine，或 save.autoSave 子对象。
 */
export {
  createAutoSaveEngine,
  type AutoSaveEngine,
  type AutoSaveEngineOptions,
} from '@mini-canvas/canvas-data'
