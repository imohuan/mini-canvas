/**
 * 兼容导出：测试探针已随 Agent 后台搬进 plugin-agent。
 *
 * 这里保留同名文件，是因为既有测试按 `../agent/traceFork.probe` 引用它；
 * 实现不在本包，避免出现第二份。
 */
export * from '@mini-canvas/plugin-agent/server/agent/traceFork.probe.js'
