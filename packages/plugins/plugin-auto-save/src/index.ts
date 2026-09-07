// plugin-auto-save —— 定时自动保存（interval 轮询脏位 → save.flush）。
export { autoSavePlugin, name, apply } from './autoSavePlugin'
export type { AutoSaveService } from './autoSavePlugin'
export {
  createAutoSaveEngine,
  type AutoSaveEngine,
  type AutoSaveEngineOptions,
} from './autoSaveEngine'
