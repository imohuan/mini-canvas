/**
 * plugin-custom-handle —— 浮动端口几何配置薄插件（v2 独立包，复刻老版 custom-handle）。
 *
 * 老版 install 时向宿主 registerHandleConfig 注入一组端口几何数值(restOffset/cursorGap/
 * buttonSize/radius…)，宿主浮动端口据此绘制。
 *
 * v2 分工（薄适配包，不重复造、零耦合）：
 * - 浮动端口外观/几何已由渲染层 CanvasHost 的 handle-visual prop（CanvasParams 契约：
 *   handleRestOffset/handleCursorGap/handleButtonSize/portZone*）提供，装配方以响应式对象传入。
 * - 内核/渲染层目前**没有**「插件经 ctx 改写宿主外观 prop」的服务通道 —— 本包明确缺口：
 *   若未来要支持插件运行时改端口几何，需在 canvas-render 补可注入的 handleParams 服务。
 * - 因此本包退化为「端口几何默认值 + 纯合并函数」独立可装配单元：宿主把返回值绑到
 *   handle-visual 即得老版同款几何；也支持自定义 overrides。
 */
import type { CanvasParams } from '@mini-canvas/canvas-render'

/** v2 CanvasParams 端口几何默认值（对齐老版 custom-handle 注入数值 + 渲染层 DEFAULT_HANDLE_VISUAL） */
export const CUSTOM_HANDLE_DEFAULTS: CanvasParams = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 86,
  portZoneHeightRatio: 0.8,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 1,
}

/** 以默认值为底、用 overrides 覆盖（undefined 忽略），返回新对象 */
export function customHandleConfig(overrides?: Partial<CanvasParams>): CanvasParams {
  if (!overrides) return { ...CUSTOM_HANDLE_DEFAULTS }
  const out: CanvasParams = { ...CUSTOM_HANDLE_DEFAULTS }
  const rec = out as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) rec[k] = v
  }
  return out
}
