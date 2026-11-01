// plugin-auto-save —— 定时自动保存（interval 轮询脏位 → save.flush）。
// 引擎实现住在 canvas-data（它描述 save 的用法），这里只导出插件本身。
export { autoSavePlugin, name, apply } from './autoSavePlugin'
export type { AutoSaveService } from './autoSavePlugin'
