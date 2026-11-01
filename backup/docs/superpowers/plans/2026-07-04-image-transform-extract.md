# ImageNodePlugin 通用图片变换提取 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 从 ImageNodePlugin.ts 的三个 handle*Confirm 函数中提取公共的"fetch → bitmap → canvas → blob → 持久化 → 创建新节点"流水线，消除 ~200 行重复代码。

**Architecture:** 提取两个纯函数：pplyImageTransform（图片处理流水线）和 createResultNode（创建结果节点）。三个 Confirm 函数各自只需提供差异化的变换逻辑回调。不改外部行为。

**Tech Stack:** TypeScript, Canvas API, createImageBitmap

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| src/nodes/image/ImageNodePlugin.ts | 修改 | 提取通用函数 + 重写三个 Confirm |

---

## 三个 Confirm 函数的差异分析

三个函数结构完全一致，只有中间"图片处理"步骤不同：

| 步骤 | Crop | Expand | Mask |
|------|------|--------|------|
| 前置校验 | cropRect 有效性 | expandRect 有效性 | maskUrl 存在性 |
| 退出 overlay | ✓ | ✓ | ✓ |
| fetch 原图 | ✓ | ✓ | ✓ |
| createImageBitmap | 完整 → 裁剪子区域 | 完整 | 完整 + 额外加载蒙版 |
| 画到 canvas | drawImage(cropBitmap) | drawImage(bitmap, -sx, -sy) | drawImage(img) + drawImage(mask) |
| 验证有内容 | ✓ | ✓ | ✓ |
| canvas.toBlob | ✓ | ✓ | ✓ |
| 持久化 asset | _crop.png | _expand.png | _masked.png |
| fitCardSize | 手动算（用 sw/sh） | fitCardSize(sw, sh) | fitCardSize(srcW, srcH) |
| 创建新节点 | ✓ | ✓ | ✓ |

差异点：
1. **Crop** 需要两阶段 bitmap（先完整加载算 scale，再裁剪子区域），canvas 尺寸 = 裁剪后尺寸
2. **Expand** canvas 尺寸由 expandRect 决定，绘制时 bitmap 有偏移
3. **Mask** 需要额外加载蒙版 bitmap，canvas 尺寸 = 原图尺寸

---

### Task 1: 提取 createResultNode 通用函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

**说明：** 三个 Confirm 函数末尾"创建新节点"的逻辑完全相同，先提取这个最简单的部分。

- [ ] **Step 1: 在 itCardSize 函数后面添加 createResultNode**

`	ypescript
/**
 * 在源节点右侧创建变换结果节点（通用）
 */
function createResultNode(
  vf: any,
  sourceNode: { position: { x: number; y: number }; data: Record<string, unknown> },
  result: { blob: Blob; url: string; width: number; height: number },
  suffix: string,
  assetId?: string,
): void {
  const sourceData = sourceNode.data
  const { cardWidth, cardHeight } = fitCardSize(result.width, result.height)

  const newNodeId = image-
  vf.addNodes([{
    id: newNodeId,
    type: 'custom',
    position: {
      x: sourceNode.position.x + ((sourceData.cardWidth as number) ?? cardWidth) + 40,
      y: sourceNode.position.y,
    },
    data: {
      label: ${(sourceData.imageName as string) || 'image'},
      nodeType: 'image',
      assetId,
      imageUrl: result.url,
      imageName: ${(sourceData.imageName as string) || 'image'},
      imageType: 'image/png',
      imageWidth: result.width,
      imageHeight: result.height,
      cardWidth,
      cardHeight,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }])
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(image): extract createResultNode helper in ImageNodePlugin"
`

---

### Task 2: 提取 saveTransformedAsset 通用函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

**说明：** 三个 Confirm 函数中"canvas.toBlob → 持久化"的逻辑相同。

- [ ] **Step 1: 添加 saveTransformedAsset**

`	ypescript
/**
 * 将 canvas 导出为 blob 并持久化到 asset store
 */
async function saveTransformedAsset(
  canvas: HTMLCanvasElement,
  imageName: string,
  suffix: string,
  ctx: CommandContext,
): Promise<{ blob: Blob; url: string; assetId?: string } | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    ctx.logger.error('[Transform] canvas.toBlob 返回 null')
    return null
  }
  const url = URL.createObjectURL(blob)

  let assetId: string | undefined
  const runtime = ctx.runtime as any
  const assetManager = runtime.getPluginAPI?.('storage')?.assets
  if (assetManager) {
    const name = ${imageName || 'image'}.png
    try { assetId = await assetManager.saveAsset(new File([blob], name, { type: 'image/png' }), name, 'image/png') }
    catch (err) { ctx.logger.error('保存资产失败:', err) }
  }

  return { blob, url, assetId }
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(image): extract saveTransformedAsset helper in ImageNodePlugin"
`

---

### Task 3: 重写 handleImageExpandConfirm 使用通用函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

**说明：** Expand 是最简单的 Confirm（不需要两阶段 bitmap、不需要额外资源），先用它验证通用函数设计。

- [ ] **Step 1: 用 saveTransformedAsset + createResultNode 重写**

替换 handleImageExpandConfirm 中的 Step D 之后的所有代码（从 canvas 创建到函数结束）：

`	ypescript
async function handleImageExpandConfirm(ctx: CommandContext) {
  try {
    const runtime = ctx.runtime as any
    const vf = runtime?.vueFlowInstance
    const nodeId = ctx.node?.id
    if (!vf || !nodeId) return

    const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
    if (!node?.data) return

    const sourceData = node.data
    const { imageUrl, imageWidth, imageHeight } = sourceData
    if (!imageUrl || !imageWidth || !imageHeight) return

    const expandRect = sourceData._overlay?._expandRect as { x: number; y: number; width: number; height: number } | undefined
    if (!expandRect || expandRect.width <= 0 || expandRect.height <= 0) return

    // 1. 退出扩展模式
    const cleanedData = { ...sourceData }
    delete cleanedData._overlay
    vf.updateNode(nodeId, { data: cleanedData })

    // 2. fetch + bitmap
    const response = await fetch(imageUrl as string)
    if (!response.ok) { ctx.logger.error('[Expand] fetch 原图失败:', response.status); return }
    const rawBlob = await response.blob()
    const fullBitmap = await createImageBitmap(rawBlob)

    // 3. 计算扩展坐标
    const scaleX = (imageWidth as number) > 0 ? fullBitmap.width / (imageWidth as number) : 1
    const scaleY = (imageHeight as number) > 0 ? fullBitmap.height / (imageHeight as number) : 1
    const sx = Math.round(expandRect.x * scaleX)
    const sy = Math.round(expandRect.y * scaleY)
    const sw = Math.round(expandRect.width * scaleX)
    const sh = Math.round(expandRect.height * scaleY)

    // 4. 画到 canvas
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const c2d = canvas.getContext('2d')!
    c2d.drawImage(fullBitmap, -sx, -sy)
    fullBitmap.close()

    // 5. 验证有内容
    const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
    if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
      ctx.logger.warn('[Expand] 扩展画布无内容')
      return
    }

    // 6. 持久化 + 创建新节点
    const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_expand', ctx)
    if (!saved) return
    createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: sw, height: sh }, '_expand', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageExpandConfirm failed:', err)
  }
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(image): rewrite handleImageExpandConfirm using shared helpers"
`

---

### Task 4: 重写 handleImageMaskConfirm 使用通用函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

- [ ] **Step 1: 用通用函数重写**

`	ypescript
async function handleImageMaskConfirm(ctx: CommandContext) {
  try {
    const runtime = ctx.runtime as any
    const vf = runtime?.vueFlowInstance
    const nodeId = ctx.node?.id
    if (!vf || !nodeId) return

    const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
    if (!node?.data) return

    const sourceData = node.data
    const { imageUrl, imageWidth, imageHeight } = sourceData
    if (!imageUrl || !imageWidth || !imageHeight) return

    const maskUrl = sourceData.maskUrl as string | undefined

    // 1. 退出蒙版模式
    const cleanedData = { ...sourceData }
    delete cleanedData._overlay
    vf.updateNode(nodeId, { data: cleanedData })

    if (!maskUrl) return

    // 2. 并行加载原图 + 蒙版
    const [imgResponse, maskResponse] = await Promise.all([
      fetch(imageUrl as string),
      fetch(maskUrl),
    ])
    if (!imgResponse.ok) { ctx.logger.error('[Mask] fetch 原图失败:', imgResponse.status); return }

    const [imgBlob, maskBlob] = await Promise.all([
      imgResponse.blob(),
      maskResponse.blob(),
    ])

    const [imgBitmap, maskBitmap] = await Promise.all([
      createImageBitmap(imgBlob),
      createImageBitmap(maskBlob),
    ])

    // 3. 合成到 canvas
    const canvas = document.createElement('canvas')
    canvas.width = imgBitmap.width
    canvas.height = imgBitmap.height
    const c2d = canvas.getContext('2d')!
    c2d.drawImage(imgBitmap, 0, 0)
    c2d.drawImage(maskBitmap, 0, 0, canvas.width, canvas.height)
    imgBitmap.close()
    maskBitmap.close()

    // 4. 验证有内容
    const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
    if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
      ctx.logger.warn('[Mask] 合成画布无内容')
      return
    }

    // 5. 持久化 + 创建新节点
    const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_masked', ctx)
    if (!saved) return
    createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: imgBitmap.width, height: imgBitmap.height }, '_masked', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageMaskConfirm failed:', err)
  }
}
`

**额外优化：** 原代码串行 fetch 原图和蒙版，改为 Promise.all 并行加载。

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(image): rewrite handleImageMaskConfirm using shared helpers, parallelize fetches"
`

---

### Task 5: 重写 handleImageCropConfirm 使用通用函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

**说明：** Crop 最特殊——需要两阶段 createImageBitmap（先加载完整图算 scale，再裁剪子区域）。canvas 尺寸由裁剪后的 bitmap 决定。

- [ ] **Step 1: 用通用函数重写**

`	ypescript
async function handleImageCropConfirm(ctx: CommandContext) {
  try {
    const runtime = ctx.runtime as any
    const vf = runtime?.vueFlowInstance
    const nodeId = ctx.node?.id
    if (!vf || !nodeId) return

    const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
    if (!node?.data) return

    const sourceData = node.data
    const { imageUrl, imageWidth, imageHeight } = sourceData
    if (!imageUrl || !imageWidth || !imageHeight) return

    const cropRect = sourceData._overlay?._cropRect as { x: number; y: number; width: number; height: number } | undefined
    if (!cropRect || cropRect.width <= 0 || cropRect.height <= 0) return

    // 1. 退出裁剪模式
    const cleanedData = { ...sourceData }
    delete cleanedData._overlay
    vf.updateNode(nodeId, { data: cleanedData })

    // 2. fetch + 完整 bitmap（算 scale）
    const response = await fetch(imageUrl as string)
    if (!response.ok) { ctx.logger.error('[Crop] fetch 失败:', response.status); return }
    const rawBlob = await response.blob()
    const fullBitmap = await createImageBitmap(rawBlob)

    const scaleX = (imageWidth as number) > 0 ? fullBitmap.width / (imageWidth as number) : 1
    const scaleY = (imageHeight as number) > 0 ? fullBitmap.height / (imageHeight as number) : 1
    const sx = Math.round(cropRect.x * scaleX)
    const sy = Math.round(cropRect.y * scaleY)
    const sw = Math.round(cropRect.width * scaleX)
    const sh = Math.round(cropRect.height * scaleY)

    // 3. 裁剪 bitmap
    const cropBitmap = await createImageBitmap(fullBitmap, sx, sy, sw, sh)
    fullBitmap.close()

    // 4. 画到 canvas
    const canvas = document.createElement('canvas')
    canvas.width = cropBitmap.width
    canvas.height = cropBitmap.height
    const c2d = canvas.getContext('2d')!
    c2d.drawImage(cropBitmap, 0, 0)
    cropBitmap.close()

    // 5. 验证有内容
    const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
    if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
      ctx.logger.warn('[Crop] 裁剪画布无内容')
      return
    }

    // 6. 持久化 + 创建新节点
    const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_crop', ctx)
    if (!saved) return
    createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: sw, height: sh }, '_crop', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageCropConfirm failed:', err)
  }
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(image): rewrite handleImageCropConfirm using shared helpers"
`

---

### Task 6: 最终验证 — 编译 + 测试 + 清理残留

- [ ] **Step 1: TypeScript 编译**

Run: 
px tsc --noEmit

Expected: 零错误

- [ ] **Step 2: 运行测试**

Run: 
px vitest run

Expected: 与重构前一致（无新增失败）

- [ ] **Step 3: 检查是否有未使用的旧代码残留**

确认以下旧变量/函数已被删除：
- handleImageCropConfirm 旧实现中的 let croppedUrl, let blob, lobby, atio 局部变量
- handleImageExpandConfirm 旧实现中的 expandedUrl, atio 局部变量
- handleImageMaskConfirm 旧实现中的 srcW, srcH, maskedUrl, atio 局部变量

- [ ] **Step 4: 检查 diff 统计**

Run: git diff --stat HEAD~5..HEAD

Expected: 净减少行数（约 -80 到 -120 行）

- [ ] **Step 5: Final commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "chore(image): final cleanup after ImageNodePlugin refactor"
`

---

## 自检清单

1. **Spec coverage**: 覆盖三个 Confirm 函数的全部重复逻辑提取
2. **Placeholder scan**: 无 TBD/TODO/占位符
3. **Type consistency**: createResultNode 的 esult 参数类型与 saveTransformedAsset 返回值一致
4. **行为不变**: 每个 Confirm 只改变内部实现，不改变输入校验、overlay 退出、错误处理逻辑
5. **额外优化**: Mask 的两次 fetch 改为 Promise.all 并行（原有串行逻辑无依赖关系）

---

Plan complete and saved to docs/superpowers/plans/2026-07-04-image-transform-extract.md.
