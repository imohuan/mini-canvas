/**
 * imageRotateDemo —— 顶栏「旋转示例」按钮的一键演示链路。
 *
 * 做 2 件事（全部走宿主公共命令/服务，不 import 其它插件）：
 * 1. **只建一个新图片节点**（command:create-node 的 imageUrl 通道），并把它连到
 *    用户**当前选中的那张图片**（没有选中图片时才先建一张示例原图）；
 * 2. 选中新节点并进入「旋转与镜像」模式 —— 用户口径 2026-10-30：
 *    「点击选择按钮的时候 创建一个新的节点 进行连接线链接，然后这个新的图片节点进入旋转模式」。
 *
 * 新节点与原图用同一张示例图：内容一致直观——旋转/翻转后一眼看出变化
 * （与用户截图的 Image-副本 → 270° 同一心智）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { openRotateMode } from './rotateSession'

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

/** 新节点与原图之间的横向间隔（原图右缘 + 100，与裁剪语义一致） */
const DEMO_GAP = 100

interface CreatePayload {
  type: string
  position: { x: number; y: number }
  imageUrl?: string
}

/** 选中集合与节点形状的最小面（供"找当前选中的图片节点"用） */
interface SelectionPort {
  /** 当前选中的节点 id 集合（getter 属性，canvas-data Selection 的形状） */
  readonly ids: ReadonlySet<string>
}

/**
 * 下一帧再执行（浏览器 rAF 两拍；node 测试退化为微任务）。
 *
 * 为什么不能同步 enter：command:create-node 返回 id 时 VueFlow 的节点视图往往还没挂载，
 * 顶栏（NodeModeTopBar）按"恰好选中本节点"渲染——selection.set 与 enter 同步调用会在
 * 视图挂载前完成，顶栏首帧拿不到选中态，模式面板就不出现（Chrome 实测复现）。
 */
function nextPaint(fn: () => void): void {
  // 不用 rAF：后台标签页 rAF 停转（Chrome 实测：点按钮后切走，回调永不执行）。
  // setTimeout 只受最低 1s 节流限制，一定会跑；300ms 跨过 VueFlow 新节点挂载动画。
  setTimeout(fn, 300)
}

/**
 * 一键演示：新建一个图片节点连到当前选中的图片 → 新节点进入旋转模式。
 * 没有选中的图片节点时，先建一张示例原图再连（保证按钮单点击通）。
 * @returns 新节点 id（失败返回 null；调用方自己提示）
 */
export function createRotateDemo(ctx: Context, at?: { x: number; y: number }): string | null {
  const command = ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command')
  const doc = ctx.get<{
    getNodes(): Array<{ id: string; type: string; position: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown> }>
    transaction<T>(reason: string, fn: (tx: {
      createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
      connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): unknown
    }) => T): T
  } | undefined>('doc')
  if (!doc) return null

  // 原图 = 当前恰好选中的那一个图片节点；没有就现场建一张（保证一键可演示）
  const selection = ctx.tryGet<SelectionPort>('selection')
  const selectedIds = Array.from(selection?.ids ?? [])
  const selectedImage =
    selectedIds.length === 1
      ? doc.getNodes().find((n) => n.id === selectedIds[0] && n.type === 'image')
      : undefined

  let source: string
  if (selectedImage) {
    source = selectedImage.id
  } else {
    // 落点：给了 at 就用它当原图的左上角；没给就按视口中心（调用方算好 flow 坐标）
    const base = at ?? { x: 120, y: 120 }
    const created = command.execute('command:create-node', {
      type: 'image',
      position: base,
      imageUrl: SAMPLE_IMAGE,
    }) as string | undefined
    if (typeof created !== 'string' || !created) return null
    source = created
  }

  // 新节点（旋转对象）摆在原图右侧：读原图的实际卡片宽（没量到就退默认 320）
  const sourceNode = doc.getNodes().find((n) => n.id === source)
  const sourcePos = sourceNode?.position ?? at ?? { x: 120, y: 120 }
  const sourceWidth = sourceNode?.size?.w ?? (sourceNode?.data?.cardWidth as number | undefined) ?? 320
  const newPosition = { x: sourcePos.x + sourceWidth + DEMO_GAP, y: sourcePos.y }
  const target = command.execute('command:create-node', {
    type: 'image',
    position: newPosition,
    imageUrl: SAMPLE_IMAGE,
  }) as string | undefined
  if (typeof target !== 'string' || !target) return null

  // 连线：原图 → 新节点（图片输出 image 口 → 图片输入 target 口；与画布拖线方向一致）
  try {
    doc.transaction('rotate-demo-pair', (tx) => {
      tx.connectEdge({ source, target, sourceHandle: 'source', targetHandle: 'target' })
    })
  } catch {
    /* 连不上（校验拒绝）不阻断演示：两个节点仍在，模式照常进 */
  }

  // 选中**新节点** + 进入旋转模式（nodeToolbar.enter 幂等；面板自己按会话渲染）
  ctx.get<{ set(ids: Iterable<string>): void }>('selection').set([target])
  nextPaint(() => {
    const svc = ctx.tryGet<{ enter?(nodeId: string, modeId: string): void } | undefined>('nodeToolbar')
    // 诊断可见化：enter 没拿到服务 / 面板没弹出时，用户至少看到一句话（正式版可静默）
    if (!svc?.enter) {
      ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.('旋转演示：nodeToolbar 服务不可用')
      return
    }
    // enter 前重申选中：节点创建后可能有别的流程（视口聚焦/测量）动过选中集合，
    // 顶栏按"恰好选中本节点"渲染——重申一次保证 enter 与选中一致。
    ctx.get<{ set(ids: Iterable<string>): void }>('selection').set([target])
    // 本插件的会话也要进（RotatePanel 按 isRotateModeActive 决定渲染；
    // 与入口组件 RotateEntry 的 enter() 同一套两步：openRotateMode + nodeToolbar.enter）
    openRotateMode(target)
    svc.enter?.(target, 'node-rotate/mode')
  })
  return target
}
