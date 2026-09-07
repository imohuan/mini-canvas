/**
 * alignGuideEngine —— 对齐辅助线纯引擎（零 Vue / 零 DOM，Node 可单测）。
 *
 * 复刻老版 canvas-core/src/plugins/align-guide/AlignGuidePlugin.ts 的吸附判定核心，抽成纯函数：
 * 拖拽节点时，与其它节点的左/右/中/上/下/垂直中 9 种模式比对，找阈值内最近对齐线，
 * 返回"被拖节点应吸附的位移"与"要画的参考线"。
 *
 * 坐标系约定：全部矩形用 **flow 绝对坐标**（x/y 为左上角，w/h 为尺寸）。
 * 与渲染层 nodeLayout.getNodeRect/getAllRects 的输出同构（{ id,x,y,w,h }），引擎不依赖其实现。
 */

/** 吸附阈值（px，flow 单位下的视觉容忍距离）—— 老版 SNAP_THRESHOLD = 8 */
export const SNAP_THRESHOLD = 8

/** 参考线类型：垂直参考线定位 x，水平参考线定位 y */
export type GuideLine = { type: 'vertical' | 'horizontal'; position: number }

/** 矩形（对齐判定用）：flow 绝对坐标 + 尺寸 */
export interface AlignRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 对齐计算结果：delta = 被拖节点应发生的位移；guides = 本次要显示的参考线 */
export interface AlignResult {
  /** 被拖节点 x 应加的位移（吸附后为 0/阈值内归零） */
  deltaX: number
  /** 被拖节点 y 应加的位移 */
  deltaY: number
  /** 本次要显示的参考线（垂直最多一条、水平最多一条，取阈值内最近者） */
  guides: GuideLine[]
}

interface Candidate {
  diff: number
  pos: number
  snap: number
}

/** 九种垂直对齐模式：比较被拖节点边/中与其它节点边/中，返回候选（含吸附位移） */
function verticalCandidates(db: Required<Omit<AlignRect, 'id'>>, ob: Required<Omit<AlignRect, 'id'>>): Candidate[] {
  return [
    { diff: Math.abs(db.x - ob.x), pos: ob.x, snap: ob.x - db.x },
    { diff: Math.abs(db.x - (ob.x + ob.w)), pos: ob.x + ob.w, snap: ob.x + ob.w - db.x },
    { diff: Math.abs(db.x - (ob.x + ob.w / 2)), pos: ob.x + ob.w / 2, snap: ob.x + ob.w / 2 - db.x },
    { diff: Math.abs(db.x + db.w - ob.x), pos: ob.x, snap: ob.x - (db.x + db.w) },
    { diff: Math.abs(db.x + db.w - (ob.x + ob.w)), pos: ob.x + ob.w, snap: ob.x + ob.w - (db.x + db.w) },
    { diff: Math.abs(db.x + db.w - (ob.x + ob.w / 2)), pos: ob.x + ob.w / 2, snap: ob.x + ob.w / 2 - (db.x + db.w) },
    { diff: Math.abs(db.x + db.w / 2 - ob.x), pos: ob.x, snap: ob.x - (db.x + db.w / 2) },
    { diff: Math.abs(db.x + db.w / 2 - (ob.x + ob.w)), pos: ob.x + ob.w, snap: ob.x + ob.w - (db.x + db.w / 2) },
    { diff: Math.abs(db.x + db.w / 2 - (ob.x + ob.w / 2)), pos: ob.x + ob.w / 2, snap: ob.x + ob.w / 2 - (db.x + db.w / 2) },
  ]
}

/** 九种水平对齐模式（对称于垂直） */
function horizontalCandidates(db: Required<Omit<AlignRect, 'id'>>, ob: Required<Omit<AlignRect, 'id'>>): Candidate[] {
  return [
    { diff: Math.abs(db.y - ob.y), pos: ob.y, snap: ob.y - db.y },
    { diff: Math.abs(db.y - (ob.y + ob.h)), pos: ob.y + ob.h, snap: ob.y + ob.h - db.y },
    { diff: Math.abs(db.y - (ob.y + ob.h / 2)), pos: ob.y + ob.h / 2, snap: ob.y + ob.h / 2 - db.y },
    { diff: Math.abs(db.y + db.h - ob.y), pos: ob.y, snap: ob.y - (db.y + db.h) },
    { diff: Math.abs(db.y + db.h - (ob.y + ob.h)), pos: ob.y + ob.h, snap: ob.y + ob.h - (db.y + db.h) },
    { diff: Math.abs(db.y + db.h - (ob.y + ob.h / 2)), pos: ob.y + ob.h / 2, snap: ob.y + ob.h / 2 - (db.y + db.h) },
    { diff: Math.abs(db.y + db.h / 2 - ob.y), pos: ob.y, snap: ob.y - (db.y + db.h / 2) },
    { diff: Math.abs(db.y + db.h / 2 - (ob.y + ob.h)), pos: ob.y + ob.h, snap: ob.y + ob.h - (db.y + db.h / 2) },
    { diff: Math.abs(db.y + db.h / 2 - (ob.y + ob.h / 2)), pos: ob.y + ob.h / 2, snap: ob.y + ob.h / 2 - (db.y + db.h / 2) },
  ]
}

function boundsOf(r: AlignRect): Required<Omit<AlignRect, 'id'>> {
  return { x: r.x, y: r.y, w: r.w, h: r.h }
}

/**
 * 计算被拖节点相对其它节点应发生的吸附。
 *
 * @param dragged 被拖节点矩形（flow 绝对坐标 + 当前实时尺寸/位置）
 * @param others  其它存活节点矩形（不含被拖节点自身；父子嵌套矩形也一并参与，绝对坐标已含父链）
 * @param threshold 吸附阈值 px（缺省 SNAP_THRESHOLD）
 */
export function computeAlignGuides(dragged: AlignRect, others: AlignRect[], threshold = SNAP_THRESHOLD): AlignResult {
  const db = boundsOf(dragged)
  // 无尺寸或无比对对象 → 无对齐
  if (db.w <= 0 || db.h <= 0 || others.length === 0) {
    return { deltaX: 0, deltaY: 0, guides: [] }
  }

  let closestV: Candidate | null = null
  let closestH: Candidate | null = null

  for (const other of others) {
    const ob = boundsOf(other)
    if (ob.w <= 0 || ob.h <= 0) continue
    for (const c of verticalCandidates(db, ob)) {
      if (c.diff < threshold && (!closestV || c.diff < closestV.diff)) closestV = c
    }
    for (const c of horizontalCandidates(db, ob)) {
      if (c.diff < threshold && (!closestH || c.diff < closestH.diff)) closestH = c
    }
  }

  const guides: GuideLine[] = []
  const deltaX = closestV?.snap ?? 0
  const deltaY = closestH?.snap ?? 0
  if (closestV) guides.push({ type: 'vertical', position: closestV.pos })
  if (closestH) guides.push({ type: 'horizontal', position: closestH.pos })

  return { deltaX, deltaY, guides }
}
