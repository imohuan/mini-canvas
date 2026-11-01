/**
 * demoMode —— 功能模式会话（纯 Vue 响应式，零 DOM）。
 *
 * 顶栏按钮与底栏面板是两处 UI，只有这份模块级会话能保证「点了哪个功能」两边一致。
 * 不写节点 data：这是纯 UI 状态（与 plugin-node-image 的 cropSession 同一条规矩），
 * 落盘 / 撤销栈都不该有它。
 */
import { shallowRef } from 'vue'

export interface DemoMode {
  /** 发起节点 id（只在这个节点上显示底栏面板） */
  nodeId: string
  /** 功能 key：只做显隐与文案，无业务 */
  kind: 'alpha' | 'beta'
}

export const demoMode = shallowRef<DemoMode | null>(null)

export function openDemoMode(nodeId: string, kind: DemoMode['kind']): void {
  demoMode.value = { nodeId, kind }
}

export function closeDemoMode(): void {
  demoMode.value = null
}

export function isDemoModeActive(nodeId: string): boolean {
  return demoMode.value?.nodeId === nodeId
}
