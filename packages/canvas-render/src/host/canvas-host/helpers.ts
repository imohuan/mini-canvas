import type { EdgeVisual } from '../../contracts/edgeContext'

/** edgeVisual 里的连线置顶开关；与 CanvasHost 原实现的类型收窄保持一致。 */
export function edgeOnTopOf(edgeVisual: Partial<EdgeVisual> | undefined): boolean {
  return (edgeVisual as { edgeOnTop?: boolean } | undefined)?.edgeOnTop ?? false
}
