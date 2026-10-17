/**
 * 热重载插件装配 —— 现在只是**一行转发**。
 *
 * 完整实现（单例 + 设置面板 + KV 监听）都在 @mini-canvas/plugin-hot-reload 包内
 * （hotReloadPlugin 导出）。这个文件保留的原因：APP_PLUGINS 的装配入口历史上指向这里，
 * 保持文件名稳定让 git 历史与 review 都好认；将来可以直接改 assembly.ts 指包根后删除本文件。
 */
export { hotReloadPlugin as uiHotReloadPlugin } from '@mini-canvas/plugin-hot-reload'
