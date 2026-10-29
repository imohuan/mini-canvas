/**
 * imagePaint —— 图片节点「笔刷绘制」引擎（笔迹存储 + 保存时生成两张图）。
 *
 * 用户口径：擦除与重绘本质是同一件事 —— 都是在原图上用笔刷标记一片区域。
 * 所以这里只做一种绘制：记录蒙版笔迹（涂/擦都是同一种笔迹，只是 kind 不同）。
 * 保存时生成两张图：
 *   1. 蒙版图 mask.png：黑底 + 白笔迹（白 = 涂过/要重绘的区域，喂生成模型的标准格式）；
 *   2. 结果图 result.png：原图按蒙版挖洞 —— 涂过的区域透明（即把蒙版区域删掉）。
 *
 * 坐标系：笔迹点全部是归一化坐标（0~1，相对图片**显示区**，不是整张卡片），
 * 保存时按蒙版尺寸（原图像素）换算。半径也存成「半径/显示区宽」的比值，
 * 所以卡片被拖大拖小、图片以任何比例显示，保存结果都不漂移。
 */

/** 一条笔迹：一次按下的完整路径 */
export interface PaintStroke {
  /** 涂（保存时把这块挖掉）或擦（把之前涂的擦回来） */
  kind: 'paint' | 'erase'
  /** 笔刷半径 / 图片显示区宽（归一化） */
  radiusRatio: number
  /** 笔刷形状：圆 / 方 */
  shape: 'round' | 'square'
  /** 路径点（归一化 0~1） */
  points: Array<{ x: number; y: number }>
}

/**
 * 把一组笔迹画进画布（透明底）：涂 = 白色不透明，擦 = 挖掉（destination-out）。
 * 这是「看到什么就存什么」的唯一画法 —— 蒙版与结果图的挖洞共用它。
 */
function paintStrokes(c2d: CanvasRenderingContext2D, strokes: PaintStroke[], w: number, h: number): void {
  for (const s of strokes) {
    if (s.points.length === 0) continue
    const r = Math.max(0.5, s.radiusRatio * w)
    c2d.save()
    c2d.globalCompositeOperation = s.kind === "paint" ? "source-over" : "destination-out"
    c2d.strokeStyle = "#ffffff"
    c2d.fillStyle = "#ffffff"
    c2d.lineWidth = r * 2
    c2d.lineJoin = "round"
    c2d.lineCap = s.shape === 'round' ? 'round' : 'butt'
    c2d.beginPath()
    c2d.moveTo(s.points[0].x * w, s.points[0].y * h)
    for (const p of s.points.slice(1)) c2d.lineTo(p.x * w, p.y * h)
    // 单点也要能画出一个点：lineTo 一个几乎相同的位置
    if (s.points.length === 1) c2d.lineTo(s.points[0].x * w + 0.01, s.points[0].y * h)
    c2d.stroke()
    if (s.shape === 'square') {
      for (const p of s.points) c2d.fillRect(p.x * w - r, p.y * h - r, r * 2, r * 2)
    }
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

/** 生成蒙版 PNG：黑底 + 白笔迹（白 = 涂过/要重绘的区域；擦过的区域回到黑） */
export async function renderMaskBlob(strokes: PaintStroke[], width: number, height: number): Promise<Blob | null> {
  return paintBlob(width, height, (c2d) => {
    c2d.fillStyle = "#000000"
    c2d.fillRect(0, 0, width, height)
    paintStrokes(c2d, strokes, width, height)
  })
}

/**
 * 生成结果图 PNG：原图按蒙版挖洞（涂过的区域透明）。
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
    // 挖洞层：透明底 + 白色笔迹（涂过的地方不透明）。擦过的笔迹把白洞再挖掉。
    const holes = document.createElement("canvas")
    holes.width = w
    holes.height = h
    const h2d = holes.getContext("2d")
    if (!h2d) return null
    paintStrokes(h2d, strokes, w, h)
    const blob = await paintBlob(w, h, (c2d) => {
      c2d.drawImage(loaded.source, 0, 0, w, h)
      // destination-out：挖洞层不透明的地方（= 涂过的区域）从结果图里抠掉
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
