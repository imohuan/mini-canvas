/**
 * rotateSession —— 「旋转与镜像」功能模式的会话（纯内存，不写节点 data）。
 *
 * 与 plugin-node-image 的 cropSession 同一条规矩：模式是纯 UI 状态，落盘/撤销栈都不该有它。
 * 面板自己按会话决定显隐（见 RotatePanel.vue），防止模式退出后还挂着旧 UI。
 */
import { shallowRef } from 'vue'

/** 当前处于旋转模式的节点 id（null = 不在任何节点上） */
export const rotateMode = shallowRef<string | null>(null)

/** 进入旋转模式（记录发起节点；nodeToolbar.enter 由入口组件自己调，两边共享同一份会话） */
export function openRotateMode(nodeId: string): void {
  rotateMode.value = nodeId
}

/** 退出旋转模式（nodeToolbar.exit 同步调；幂等） */
export function closeRotateMode(): void {
  rotateMode.value = null
}

/** 某个节点是否正在旋转模式里 */
export function isRotateModeActive(nodeId: string): boolean {
  return rotateMode.value === nodeId
}
