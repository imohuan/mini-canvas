/**
 * imagePaint —— 图片节点「笔刷绘制」引擎（笔迹存储 + 保存时生成两张图）。
 *
 * 用户口径（2026-10-30）：三种模式 —— 画笔（自由画）/ 矩形填充 / 橡皮擦。
 * 擦除与重绘本质是同一件事：都在原图上标记一片区域。
 *
 * 保存时生成两张图：
 *   1. 蒙版图 mask.png：黑底 + 白标记（白 = 标记过的区域，喂生成模型的标准格式）；
 *   2. 结果图 result.png：原图按蒙版挖洞 —— 标记区域透明（即把标记区域删掉）。
 *
 * 坐标：笔迹点全部归一化（0~1，相对图片显示区），保存时按蒙版尺寸（原图像素）换算；
 * 半径存「半径 / 显示区宽」的比值 —— 卡片被拖大拖小、画布怎么缩放都不影响保存结果。
 *
 * 颜色：会话里选的标记色只影响**预览**与蒙版观感；结果图靠 alpha 挖洞，与颜色无关。
 */

/** 一条笔迹 */
export interface PaintStroke {
  /** 工具：画笔（自由路径）/ 矩形填充 / 橡皮擦 */
  tool: 'brush' | 'rect' | 'erase'
  /** 标记色（#rrggbb 或 #rrggbbaa）；橡皮擦忽略 */
  color: string
  /** 笔刷半径 / 图片显示区宽（归一化；矩形与橡皮擦也用它的线宽语义） */
  radiusRatio: number
  /** 路径点（归一化 0~1）：画笔是完整路径；矩形是 [起点, 终点] */
  points: Array<{ x: number; y: number }>
}

/**
 * 把一组笔迹画到画布上（坐标已是目标画布像素）。
 * mode = "mask"：黑底白标记（结果图挖洞用）；mode = "preview"：用笔迹自己的颜色（界面预览用）。
 * 橡皮擦两种模式都表现为「把已画的挖掉」。
 */
export function paintStrokes(
  c2d: CanvasRenderingContext2D,
  strokes: PaintStroke[],
  w: number,
  h: number,
  mode: "mask" | "preview" = "mask",
): void {
  for (const s of strokes) {
    if (s.points.length === 0) continue
    const r = Math.max(0.5, s.radiusRatio * w)
    c2d.save()
    if (s.tool === 'erase') {
      c2d.globalCompositeOperation = "destination-out"
      c2d.strokeStyle = "#000000"
      c2d.fillStyle = "#000000"
    } else if (mode === 'mask') {
      c2d.globalCompositeOperation = "source-over"
      c2d.strokeStyle = "#ffffff"
      c2d.fillStyle = "#ffffff"
    } else {
      c2d.globalCompositeOperation = "source-over"
      c2d.strokeStyle = s.color
      c2d.fillStyle = s.color
    }
    if (s.tool === 'rect') {
      const a = s.points[0]
      const b = s.points[s.points.length - 1]
      const x = Math.min(a.x, b.x) * w
      const y = Math.min(a.y, b.y) * h
      const rw = Math.abs(b.x - a.x) * w
      const rh = Math.abs(b.y - a.y) * h
      c2d.fillRect(x, y, rw, rh)
      c2d.restore()
      continue
    }
    c2d.lineWidth = r * 2
    c2d.lineJoin = "round"
    c2d.lineCap = "round"
    c2d.beginPath()
    c2d.moveTo(s.points[0].x * w, s.points[0].y * h)
    for (const p of s.points.slice(1)) c2d.lineTo(p.x * w, p.y * h)
    // 单点也要能画出一个点：lineTo 一个几乎相同的位置
    if (s.points.length === 1) c2d.lineTo(s.points[0].x * w + 0.01, s.points[0].y * h)
    c2d.stroke()
    c2d.restore()
  }
}

/** 图片 → 可绘制源（ImageBitmap 优先，退回 img 标签） */
async function loadSource(url: string): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const bitmap = await createImageBitmap(await res.blob())
        return { source: bitmap, width: bitmap.width, height: bitmap.height }
      }
    } catch {
      /* 退回 img 路径 */
    }
  }
  if (typeof Image === 'undefined') return null
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function release(source: CanvasImageSource): void {
  const maybe = source as { close?: () => void }
  if (typeof maybe.close === 'function') maybe.close()
}

/** 建一块画布让 draw 画完，然后取 PNG Blob（非浏览器环境返回 null） */
function paintBlob(width: number, height: number, draw: (c2d: CanvasRenderingContext2D) => void): Promise<Blob | null> {
  if (typeof document === 'undefined' || width <= 0 || height <= 0) return Promise.resolve(null)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const c2d = canvas.getContext("2d")
  if (!c2d) return Promise.resolve(null)
  draw(c2d)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.size > 0 ? blob : null), "image/png")
  })
}

/** 生成蒙版 PNG：黑底 + 白标记（标记过 = 白；擦掉的区域回到黑） */
export async function renderMaskBlob(strokes: PaintStroke[], width: number, height: number): Promise<Blob | null> {
  return paintBlob(width, height, (c2d) => {
    c2d.fillStyle = "#000000"
    c2d.fillRect(0, 0, width, height)
    paintStrokes(c2d, strokes, width, height, 'mask')
  })
}

/**
 * 生成结果图 PNG：原图按标记挖洞（标记过的区域透明）。
 * 原图真实像素与蒙版尺寸不一致时按蒙版尺寸缩放对齐（裁剪/扩展同款处理）。
 */
export async function renderResultBlob(
  imageUrl: string,
  strokes: PaintStroke[],
  width: number,
  height: number,
): Promise<{ blob: Blob | null; width: number; height: number } | null> {
  const loaded = await loadSource(imageUrl)
  if (!loaded) return null
  try {
    const w = width > 0 ? width : loaded.width
    const h = height > 0 ? height : loaded.height
    // 挖洞层：透明底 + 白色标记。擦过的笔迹把白洞再挖掉。
    const holes = document.createElement("canvas")
    holes.width = w
    holes.height = h
    const h2d = holes.getContext("2d")
    if (!h2d) return null
    paintStrokes(h2d, strokes, w, h, 'mask')
    const blob = await paintBlob(w, h, (c2d) => {
      c2d.drawImage(loaded.source, 0, 0, w, h)
      // destination-out：挖洞层不透明的地方（= 标记过的区域）从结果图里抠掉
      c2d.globalCompositeOperation = "destination-out"
      c2d.drawImage(holes, 0, 0)
      c2d.globalCompositeOperation = "source-over"
    })
    if (!blob) return null
    return { blob, width: w, height: h }
  } finally {
    release(loaded.source)
  }
}
