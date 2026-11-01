/**
 * 兼容导出：Agent 后台实现已经搬到 `@mini-canvas/plugin-agent`。
 *
 * 留着这一层只有一个理由：cloud-server 内部与既有测试还按 `./agent/<name>.js` 引用。
 * 新增代码请直接引插件包；这一层不再放任何实现，避免又长出第二份。
 */
export * from '@mini-canvas/plugin-agent/server/agent/approval.js'
