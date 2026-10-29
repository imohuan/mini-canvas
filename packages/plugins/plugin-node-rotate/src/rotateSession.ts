/**
 * rotateSession —— 「旋转与镜像」功能模式的会话（纯内存，不写节点 data）。
 *
 * 与 plugin-node-image 的 cropSession 同一条规矩：模式是纯 UI 状态，落盘/撤销栈都不该有它。
 * 面板自己按会话决定显隐（见 RotatePanel.vue），防止模式退出后还挂着旧 UI。
 */
import { shallowRef } from 'vue'

/** 功能模式 id（入口、注册、测试共用一个常量，避免字符串各写一遍） */
export const ROTATE_MODE_ID = 'node-rotate/mode'

/** 当前处于旋转模式的节点 id（null = 不在任何节点上） */
export const rotateMode = shallowRef<string | null>(null)

/**
 * 当前累计旋转角度（0/90/180/270，仅用于顶栏展示）。
 *
 * 为什么不读节点 data：旋转是像素级重绘，节点里没有「转了几度」这个字段；
 * 再写一个字段又会进撤销栈，翻一次图多一条历史。会话级计数只服务本次编辑。
 */
export const rotateAngle = shallowRef(0)

/** 进入旋转模式（记录发起节点；nodeToolbar.enter 由入口组件自己调，两边共享同一份会话）。
 *  每次进入都从 0° 起算 —— 新副本本来就没转过。 */
export function openRotateMode(nodeId: string): void {
  rotateMode.value = nodeId
  rotateAngle.value = 0
}

/** 退出旋转模式（nodeToolbar.exit 同步调；幂等） */
export function closeRotateMode(): void {
  rotateMode.value = null
  rotateAngle.value = 0
}

/** 右转成功一次：角度 +90°，满 360 归零（只在模式里有意义，退出后不累计） */
export function bumpRotateAngle(): void {
  if (rotateMode.value === null) return
  rotateAngle.value = (rotateAngle.value + 90) % 360
}

/** 某个节点是否正在旋转模式里 */
export function isRotateModeActive(nodeId: string): boolean {
  return rotateMode.value === nodeId
}
