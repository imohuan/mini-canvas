// plugin-auto-save —— 定时自动保存（interval 轮询脏位 → save.flush）。
// 引擎实现已收进 canvas-data（它描述 save 的用法，不是独立服务）；这里保留兼容再导出。
export { autoSavePlugin, name, apply } from './autoSavePlugin'
export type { AutoSaveService } from './autoSavePlugin'
export {
  createAutoSaveEngine,
  type AutoSaveEngine,
  type AutoSaveEngineOptions,
} from './autoSaveEngine'
