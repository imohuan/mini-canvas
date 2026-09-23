/**
 * selectionRegion —— 读"多选框区域场"的条目（纯函数，零 Vue 可单测）。
 *
 * 与节点侧 canvas-data/canvas/region.ts 的 nodeRegionStackEntries 是同一件事的两个宿主：
 * 那边是"某类型节点的某区域"，这边是"选择集的某区域"——**没有 type 那一维**（多选框不是某种节点），
 * 所以键就是区域词本身，也没有基座（多选框的基座就是框本身，不在场里）。
 */
import type { NodeSegmentEntry } from '@mini-canvas/canvas-data'

/** 场里一条的读回形状（component + 条目自己的 needs/props） */
interface RegionAttachmentLike {
  component?: unknown
  needs?: string[]
  props?: Record<string, unknown>
}

/**
 * 某区域的完整渲染摞：按 order 升序（小者在外），props/needs 一并透传给渲染层。
 *
 * @param field  registryOf('selection/region')；缺省（极简宿主/测试桩）= 空摞
 * @param region 区域词（十个之一；这里不做守卫 —— 守卫在写入端 assertRegion 已做）
 */
export function selectionRegionEntries(
  field: { list(key: string): Array<{ id: string; value: unknown }> } | undefined,
  region: string,
): NodeSegmentEntry[] {
  if (!field) return []
  return field.list(region).map((e) => {
    const value = (e.value ?? {}) as RegionAttachmentLike
    return {
      id: e.id,
      component: value.component,
      // 只有真带了才写字段：不凭空造 props:undefined / needs:[]（消费者判空即"没声明"）
      ...(value.props ? { props: value.props } : {}),
      ...(value.needs && value.needs.length > 0 ? { needs: value.needs } : {}),
    }
  })
}
