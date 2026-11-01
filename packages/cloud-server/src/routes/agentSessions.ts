/**
 * 兼容导出：Agent 的三组 HTTP 外壳已搬到 `@mini-canvas/plugin-agent`（server/routes）。
 *
 * 路由形状没变（还是 /api/agent/*），所以宿主与既有测试继续按旧路径引用也不会炸；
 * 新增代码请直接引插件包。
 */
export * from '@mini-canvas/plugin-agent/server/routes/agentSessions.js'
