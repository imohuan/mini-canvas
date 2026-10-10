// 文件：packages/docs/public/examples/canvas-render/canvas-host/src/uiState.ts
// 格式：TypeScript 模块（导出响应式对象）
// 位置：外观参数的唯一住址；交给 CanvasHost 后改属性即实时生效
import { reactive } from 'vue'
import type { CanvasParams, EdgeVisual } from '@mini-canvas/canvas-render'

// ① 边外观：Partial 即可，没给的字段用宿主默认值
export const edge: Partial<EdgeVisual> = reactive({
  edgeColor: '#3b82f6',
  edgeLineWidth: 2,
  edgeOnTop: false,        // 关掉「连线显示在最上层」
})

// ② 浮动端口：必须是**含全部字段**的对象（BaseNode 读它不做逐字段回落）
export const handle: CanvasParams = reactive({
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10,
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 0.8,
})
