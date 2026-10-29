/**
 * imageRotateDemo —— 顶栏「旋转示例」按钮的一键演示链路。
 *
 * 做 4 件事（全部走宿主公共命令/服务，不 import 其它插件）：
 * 1. 用 SAMPLE_IMAGE 建一个空图片节点（command:create-node 的 imageUrl 通道）；
 * 2. 在它右侧再建一个（两个节点并排）；
 * 3. 连一条线（doc.transaction + connectEdge：建节点连边同一次撤销）；
 * 4. 选中第二个节点并进入「旋转与镜像」模式。
 *
 * 为什么用 SVG 示例图而不是空白节点：旋转/翻转必须有真实像素才有意义；
 * 空白节点只能让用户先手动上传，按钮就不是“一键看效果”了。
 */
import type { Context } from '@mini-canvas/canvas-base'

/** 示例图：一张 480×360 的 SVG（dataURL，无外部依赖） */
export const SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
      // 主题色白名单: 示例图素材色（画进图片节点的位图内容，不是界面配色；参照 ui/assembly.ts 的 SAMPLE_IMAGE_URL）
      '<rect width="480" height="360" fill="#dbeafe"/>' +
      // 主题色白名单: 示例图素材色（同上）
      '<circle cx="150" cy="150" r="70" fill="#0891b2"/>' +
      // 主题色白名单: 示例图素材色（同上）
      '<rect x="260" y="120" width="140" height="90" rx="12" fill="#fbbf24"/>' +
      // 主题色白名单: 示例图素材色（同上）
      '<text x="240" y="320" font-family="sans-serif" font-size="24" fill="#1d4ed8" text-anchor="middle">旋转示例</text>' +
      '</svg>',
  )

/** 两个示例节点之间的横向间隔（原图右缘 + 100，与裁剪语义一致） */
const DEMO_GAP = 100

interface CreatePayload {
  type: string
  position: { x: number; y: number }
  imageUrl?: string
}

/**
 * 一键演示：建两个相连的图片节点并进入第二个的旋转模式。
 * @returns 新节点 id（失败返回 null；调用方自己提示）
 */
export function createRotateDemoPair(ctx: Context, at?: { x: number; y: number }): string | null {
  const command = ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command')
  const doc = ctx.get<{
    getNodes(): Array<{ id: string; position: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown> }>
    transaction<T>(reason: string, fn: (tx: {
      createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
      connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): unknown
    }) => T): T
  } | undefined>('doc')
  if (!doc) return null

  // 落点：给了 at 就用它当第一颗的左上角；没给就按视口中心（调用方算好 flow 坐标）
  const base = at ?? { x: 120, y: 120 }
  const first = command.execute('command:create-node', {
    type: 'image',
    position: base,
    imageUrl: SAMPLE_IMAGE,
  }) as string | undefined
  if (typeof first !== 'string' || !first) return null

  // 第二颗摆在第一颗右侧：读第一颗的实际卡片宽（没量到就退默认 320）
  const firstNode = doc.getNodes().find((n) => n.id === first)
  const firstWidth = firstNode?.size?.w ?? (firstNode?.data?.cardWidth as number | undefined) ?? 320
  const secondPosition = { x: base.x + firstWidth + DEMO_GAP, y: base.y }
  const second = command.execute('command:create-node', {
    type: 'image',
    position: secondPosition,
    imageUrl: SAMPLE_IMAGE,
  }) as string | undefined
  if (typeof second !== 'string' || !second) return null

  // 连线：第一颗 → 第二颗（图片输出 image 口 → 图片输入 target 口；与画布拖线方向一致）
  try {
    doc.transaction('rotate-demo-pair', (tx) => {
      tx.connectEdge({ source: first, target: second, sourceHandle: 'source', targetHandle: 'target' })
    })
  } catch {
    /* 连不上（校验拒绝）不阻断演示：两个节点仍在，模式照常进 */
  }

  // 选中第二颗 + 进入旋转模式（nodeToolbar.enter 幂等；面板自己按会话渲染）
  ctx.get<{ set(ids: Iterable<string>): void }>('selection').set([second])
  ctx.tryGet<{ enter?(nodeId: string, modeId: string): void }>('nodeToolbar')
    ?.enter?.(second, 'node-rotate/mode')
  return second
}
