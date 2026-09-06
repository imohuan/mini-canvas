/**
 * utils/log.ts —— v2 画布统一诊断日志（前缀 `[v2:<scope>]`，便于在 console 按前缀快速检索）。
 *
 * 调试阶段默认全开。Scope 取值约定（各模块一致）：
 *   canvas-host    —— CanvasHost 生命周期/校验/同步
 *   conn-line      —— 拖线临时连接线 + 连接反馈(resolveFeedback)
 *   base-node      —— BaseNode(壳) 渲染/端口/连接反馈
 *   moving-handle  —— 浮动端口 MovingHandle
 *   edge           —— CustomEdge / 边渲染取值
 *   config         —— demo 侧设置项接线（bindThemeSettings 灌入/窄更新）
 *   debug-overlay  —— 调试叠加(SVG) 显隐
 *
 * 只打关键动作 + 小对象/数字；不打整节点/整边数组，避免刷屏。某 scope 想静音时把 enabledByScope 对应置 false。
 */
const enabledByScope: Record<string, boolean> = {}
// 需要一个总开关时置 false 关全部
const ENABLED = true

export interface V2Logger {
  /** info 级：普通状态/动作日志 */
  log(...args: unknown[]): void
  /** warn 级：可疑/降级路径 */
  warn(...args: unknown[]): void
  /** error 级：确实出错 */
  error(...args: unknown[]): void
}

export function createV2Logger(scope: string): V2Logger {
  const tag = `[v2:${scope}]`
  const on = () => ENABLED && enabledByScope[scope] !== false
  return {
    log: (...args) => {
      if (on()) console.log(tag, ...args)
    },
    warn: (...args) => {
      if (on()) console.warn(tag, ...args)
    },
    error: (...args) => {
      if (on()) console.error(tag, ...args)
    },
  }
}
