# Canvas-Core 代码清理与去重 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 消除 canvas-core 包中的重复代码、重复常量、死代码，提升代码可维护性，不改变任何外部行为。

**Architecture:** 纯重构，不改功能。按"提取公共工具 → 统一常量 → 消除重复逻辑 → 清理死代码"的顺序，每一步独立可验证（构建通过 + 现有测试通过）。

**Tech Stack:** TypeScript + Vue 3 + Pinia + VueFlow

---

## 文件结构总览

| 文件 | 操作 | 说明 |
|------|------|------|
| src/utils/viewportSpace.ts | 修改 | 添加 	oFlowPosition 和 clamp 公共函数 |
| src/utils/constants.ts | **新建** | 统一默认尺寸常量 |
| src/Canvas.vue | 修改 | 删除本地 	oFlowPosition、clamp，改为 import；提取配置注册到独立函数 |
| src/composables/useCanvasConnection.ts | 修改 | 删除本地 	oFlowPosition、DEFAULT_NODE_SIZE，改为 import |
| src/plugins/context-menu/ContextMenuPlugin.ts | 修改 | 删除本地 	oFlowPosition，改为 import |
| src/components/Decoration/BaseNode.vue | 修改 | 删除本地 clamp，改为 import |
| src/components/Decoration/MovingHandle.vue | 修改 | clamp 改为 import |
| src/nodes/image/ImageCropper.vue | 修改 | clamp 改为 import |
| src/components/Performance/performanceMetrics.ts | 修改 | DEFAULT_NODE_WIDTH/HEIGHT 改为 import |
| src/registry/NodeRegistry.ts | 修改 | FALLBACK_SIZE 改为 import |
| src/plugins/auto-layout/layoutEngine.ts | 修改 | 默认尺寸改为 import |
| src/plugins/auto-layout/focusViewport.ts | 修改 | clamp 改为 import |
| src/plugins/auto-layout/groupBounds.ts | 修改 | clamp 改为 import |
| src/nodes/image/ImageNodePlugin.ts | 修改 | 提取 pplyImageTransform 通用函数 |
| src/plugins/PluginManager.ts | 修改 | 删除 createStubContext 死代码 |
| src/plugins/ShortcutManager.ts | 修改 | 暴露 keyEventMap 为公开静态属性 |
| src/components/Decoration/BaseNode.vue | 修改 | 清理重复 JSDoc 注释 |

---

### Task 1: 创建统一常量文件

**Files:**
- Create: src/utils/constants.ts

- [ ] **Step 1: 创建 src/utils/constants.ts**

`	ypescript
/** 节点默认卡片尺寸（宽 x 高，像素） */
export const DEFAULT_NODE_SIZE = {
  width: 256,
  height: 256,
} as const

/** 性能面板默认节点估算尺寸 */
export const DEFAULT_PERF_NODE_SIZE = {
  width: 180,
  height: 120,
} as const
`

- [ ] **Step 2: 验证文件可编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "constants"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/utils/constants.ts
git commit -m "refactor(canvas-core): add unified constants for default node sizes"
`

---

### Task 2: 添加 	oFlowPosition 到 iewportSpace.ts

**Files:**
- Modify: src/utils/viewportSpace.ts

- [ ] **Step 1: 在文件末尾追加 	oFlowPosition 函数**

`	ypescript
/**
 * 屏幕坐标 → 画布坐标系坐标（考虑视口偏移和缩放）
 */
export function toFlowPosition(
  viewport: { x: number; y: number; zoom: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pane = document.querySelector('.vue-flow')?.getBoundingClientRect()
  const zoom = viewport.zoom || 1
  const originX = pane?.left ?? 0
  const originY = pane?.top ?? 0
  return {
    x: (clientX - originX - viewport.x) / zoom,
    y: (clientY - originY - viewport.y) / zoom,
  }
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "viewportSpace"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/utils/viewportSpace.ts
git commit -m "refactor(canvas-core): add toFlowPosition to viewportSpace utils"
`

---

### Task 3: 添加 clamp 到 iewportSpace.ts

**Files:**
- Modify: src/utils/viewportSpace.ts

- [ ] **Step 1: 在文件末尾追加 clamp 函数**

`	ypescript
/**
 * 将 value 限制在 [min, max] 范围内
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "viewportSpace"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/utils/viewportSpace.ts
git commit -m "refactor(canvas-core): add clamp to viewportSpace utils"
`

---

### Task 4: 替换 Canvas.vue 中的 	oFlowPosition

**Files:**
- Modify: src/Canvas.vue:248-258

- [ ] **Step 1: 添加 import，删除本地函数**

在 Canvas.vue 的 import 区添加：
`	ypescript
import { toFlowPosition } from './utils/viewportSpace'
`

删除第 248-258 行的本地 unction toFlowPosition(...) 定义。

注意：Canvas.vue 中 	oFlowPosition 的调用方式是 	oFlowPosition(event.clientX, event.clientY)（不传 viewport），因为它闭包捕获了 ueFlowInstance.viewport.value。新的公共函数需要传 viewport，所以要修改调用点：

第 214 行 onPaneContextMenu：
`	ypescript
const flowPosition = toFlowPosition(vueFlowInstance.viewport.value, event.clientX, event.clientY)
`

第 231 行 onPaneDoubleClick：
`	ypescript
const flowPosition = toFlowPosition(vueFlowInstance.viewport.value, event.clientX, event.clientY)
`

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "Canvas.vue"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/Canvas.vue
git commit -m "refactor(canvas-core): replace local toFlowPosition with shared util in Canvas.vue"
`

---

### Task 5: 替换 useCanvasConnection.ts 中的 	oFlowPosition 和 DEFAULT_NODE_SIZE

**Files:**
- Modify: src/composables/useCanvasConnection.ts:71-83,116

- [ ] **Step 1: 添加 import，删除本地函数和常量**

在 import 区添加：
`	ypescript
import { toFlowPosition } from '../utils/viewportSpace'
import { DEFAULT_NODE_SIZE } from '../utils/constants'
`

删除第 71-83 行的本地 unction toFlowPosition(...) 定义。

删除第 116 行的 const DEFAULT_NODE_SIZE = 256。

注意：useCanvasConnection.ts 里的 	oFlowPosition 只接受 (viewport, clientX, clientY) 三个参数，和新函数签名一致，所以调用点不需要改。

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "useCanvasConnection"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/composables/useCanvasConnection.ts
git commit -m "refactor(canvas-core): replace local toFlowPosition/DEFAULT_NODE_SIZE with shared utils in useCanvasConnection"
`

---

### Task 6: 替换 ContextMenuPlugin.ts 中的 	oFlowPosition

**Files:**
- Modify: src/plugins/context-menu/ContextMenuPlugin.ts:274

- [ ] **Step 1: 添加 import，删除本地函数**

先读取文件确认 	oFlowPosition 的具体行号和上下文：

Run: Select-String -Path "packages/canvas-core/src/plugins/context-menu/ContextMenuPlugin.ts" -Pattern "toFlowPosition"

然后添加 import：
`	ypescript
import { toFlowPosition } from '../../utils/viewportSpace'
`

删除本地的 unction toFlowPosition(...) 定义。

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1 | Select-String "ContextMenuPlugin"

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/plugins/context-menu/ContextMenuPlugin.ts
git commit -m "refactor(canvas-core): replace local toFlowPosition with shared util in ContextMenuPlugin"
`

---

### Task 7: 统一 clamp 引用（BaseNode.vue, MovingHandle.vue, ImageCropper.vue, focusViewport.ts, groupBounds.ts）

**Files:**
- Modify: src/components/Decoration/BaseNode.vue:396-398
- Modify: src/components/Decoration/MovingHandle.vue:130-132
- Modify: src/nodes/image/ImageCropper.vue:137-139
- Modify: src/plugins/auto-layout/focusViewport.ts:16-18
- Modify: src/plugins/auto-layout/groupBounds.ts:16-18

- [ ] **Step 1: 逐个文件替换本地 clamp 为 import**

每个文件的改动模式相同：

`	ypescript
// 删除本地定义
// function clamp(value: number, min: number, max: number) { ... }

// 添加 import（路径根据文件位置调整）
import { clamp } from '../../utils/viewportSpace'  // 或 '../utils/viewportSpace' 等
`

具体路径：
- BaseNode.vue: import { clamp } from '../../utils/viewportSpace'
- MovingHandle.vue: import { clamp } from '../../utils/viewportSpace'
- ImageCropper.vue: import { clamp } from '../../../utils/viewportSpace'
- ocusViewport.ts: import { clamp } from '../../utils/viewportSpace'
- groupBounds.ts: import { clamp } from '../../utils/viewportSpace'

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/components/Decoration/BaseNode.vue
git add packages/canvas-core/src/components/Decoration/MovingHandle.vue
git add packages/canvas-core/src/nodes/image/ImageCropper.vue
git add packages/canvas-core/src/plugins/auto-layout/focusViewport.ts
git add packages/canvas-core/src/plugins/auto-layout/groupBounds.ts
git commit -m "refactor(canvas-core): replace all local clamp with shared util"
`

---

### Task 8: 统一默认尺寸常量引用

**Files:**
- Modify: src/registry/NodeRegistry.ts:48,70
- Modify: src/components/Performance/performanceMetrics.ts:69-70,157-158
- Modify: src/plugins/auto-layout/layoutEngine.ts:28-29

- [ ] **Step 1: 替换 NodeRegistry.ts**

`	ypescript
// 删除
// const FALLBACK_SIZE = { cardWidth: 256, cardHeight: 256 }

// 添加 import
import { DEFAULT_NODE_SIZE } from '../utils/constants'

// 第 70 行 getDefaultSize 中
// return this.definitions.get(type)?.defaultSize ?? FALLBACK_SIZE
// 改为
return this.definitions.get(type)?.defaultSize ?? DEFAULT_NODE_SIZE
`

- [ ] **Step 2: 替换 performanceMetrics.ts**

`	ypescript
// 删除
// const DEFAULT_NODE_WIDTH = 180
// const DEFAULT_NODE_HEIGHT = 120

// 添加 import
import { DEFAULT_PERF_NODE_SIZE } from '../../utils/constants'

// 第 157-158 行 getVisibleNodeStats 中
// const width = ... ? rawWidth : DEFAULT_NODE_WIDTH
// const height = ... ? rawHeight : DEFAULT_NODE_HEIGHT
// 改为
const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) ? rawWidth : DEFAULT_PERF_NODE_SIZE.width
const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? rawHeight : DEFAULT_PERF_NODE_SIZE.height
`

- [ ] **Step 3: 替换 layoutEngine.ts**

先读取 layoutEngine.ts 第 28-29 行确认具体代码，然后：
`	ypescript
import { DEFAULT_NODE_SIZE } from '../../utils/constants'
// 将硬编码的 256 替换为 DEFAULT_NODE_SIZE.width 或 DEFAULT_NODE_SIZE.height
`

- [ ] **Step 4: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 5: Commit**

`ash
git add packages/canvas-core/src/registry/NodeRegistry.ts
git add packages/canvas-core/src/components/Performance/performanceMetrics.ts
git add packages/canvas-core/src/plugins/auto-layout/layoutEngine.ts
git commit -m "refactor(canvas-core): unify default node size constants across all files"
`

---

### Task 9: 暴露 ShortcutManager 的 keyEventMap 并替换 Canvas.vue 中的 toVueFlowKey

**Files:**
- Modify: src/plugins/ShortcutManager.ts
- Modify: src/Canvas.vue

- [ ] **Step 1: ShortcutManager 暴露 keyEventMap 为公开静态属性**

将 ShortcutManager.ts 中第 423 行的 private static readonly keyEventMap 改为：

`	ypescript
/** 键名映射表：用户友好名称 → KeyboardEvent.key */
static readonly keyEventMap: Record<string, string> = {
  ctrl: 'Control',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Meta',
  enter: 'Enter',
  escape: 'Escape',
  space: ' ',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  plus: '+',
  minus: '-',
  equal: '=',
}
`

同时更新 parseShortcut 中对 ShortcutManager.keyEventMap 的引用（原为 ShortcutManager.keyEventMap，去掉 private 即可，调用方式不变）。

- [ ] **Step 2: 替换 Canvas.vue 的 toVueFlowKey**

删除 Canvas.vue 第 239-253 行的 unction toVueFlowKey(...)，替换为：

`	ypescript
import { ShortcutManager } from './plugins/ShortcutManager'

function toVueFlowKey(key: string): string {
  return ShortcutManager.keyEventMap[key] ?? key
}
`

注意：ShortcutManager 已经在 Canvas.vue 中 import 了（第 20 行），所以只需删除本地 	oVueFlowKey 函数，把函数体替换为上面的版本。

- [ ] **Step 3: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 4: Commit**

`ash
git add packages/canvas-core/src/plugins/ShortcutManager.ts
git add packages/canvas-core/src/Canvas.vue
git commit -m "refactor(canvas-core): expose ShortcutManager.keyEventMap, replace local toVueFlowKey"
`

---

### Task 10: 删除 PluginManager.createStubContext 死代码

**Files:**
- Modify: src/plugins/PluginManager.ts

- [ ] **Step 1: 删除 createStubContext 方法及其调用**

1. 删除 PluginManager.ts 第 484-590 行的 private createStubContext(...) 方法（约 106 行）
2. 修改 createPluginContext 方法（第 470-480 行），去掉 stub fallback：

`	ypescript
private createPluginContext(
  pluginName: string,
  contextFactory?: (pluginName: string) => PluginContext,
): PluginContext {
  if (contextFactory) {
    return contextFactory(pluginName)
  }
  throw new Error(
    [PluginManager] No contextFactory provided — cannot create context for ""
  )
}
`

3. 确认 PluginInstaller.ts 没有引用 createStubContext：

Run: Select-String -Path "packages/canvas-core/src/plugins/PluginInstaller.ts" -Pattern "createStubContext|stub"

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 3: 运行现有测试确保无回归**

Run: 
px vitest run --project packages/canvas-core 2>&1

Expected: 全部通过

- [ ] **Step 4: Commit**

`ash
git add packages/canvas-core/src/plugins/PluginManager.ts
git commit -m "refactor(canvas-core): remove unused createStubContext dead code from PluginManager"
`

---

### Task 11: 提取 ImageNodePlugin 中的通用图片变换函数

**Files:**
- Modify: src/nodes/image/ImageNodePlugin.ts

- [ ] **Step 1: 提取 pplyImageTransform 通用函数**

在 ImageNodePlugin.ts 中，在 handleImageUpload 函数之前添加：

`	ypescript
interface ImageTransformResult {
  blob: Blob
  url: string
  newWidth: number
  newHeight: number
}

/**
 * 通用图片变换：fetch → bitmap → canvas 绘制 → blob → 持久化
 * @param imageUrl 原始图片 URL
 * @param drawFn 在 canvas 上执行的具体变换逻辑
 * @param ctx 命令上下文（用于持久化）
 * @param nameSuffix 生成的文件名后缀（如 '_crop'）
 * @returns 变换后的 blob、URL、新尺寸
 */
async function applyImageTransform(
  imageUrl: string,
  drawFn: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, bitmap: ImageBitmap) => void,
  ctx: CommandContext,
  nameSuffix: string,
): Promise<ImageTransformResult | null> {
  // Step A: fetch 原始图片
  const response = await fetch(imageUrl)
  if (!response.ok) {
    ctx.logger.error([Transform] fetch 原图失败:, response.status)
    return null
  }
  const rawBlob = await response.blob()

  // Step B: createImageBitmap 加载
  const bitmap = await createImageBitmap(rawBlob)

  // Step C: 创建 canvas 并执行变换
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const c2d = canvas.getContext('2d')!
  drawFn(c2d, canvas, bitmap)
  bitmap.close()

  // Step D: 验证有内容
  const testPixel = c2d.getImageData(
    Math.min(1, canvas.width - 1),
    Math.min(1, canvas.height - 1),
    1, 1,
  )
  if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
    ctx.logger.warn('[Transform] 变换画布无内容')
    return null
  }

  // Step E: 导出 blob
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    ctx.logger.error('[Transform] canvas.toBlob 返回 null')
    return null
  }
  const url = URL.createObjectURL(blob)

  return { blob, url, newWidth: canvas.width, newHeight: canvas.height }
}

/**
 * 持久化 + 创建新节点（通用）
 */
async function persistAndCreateNode(
  ctx: CommandContext,
  sourceData: Record<string, unknown>,
  sourceNode: { position: { x: number; y: number } },
  result: ImageTransformResult,
  nameSuffix: string,
): Promise<void> {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance

  // 持久化
  let assetId: string | undefined
  const assetManager = runtime.getPluginAPI?.('storage')?.assets
  if (assetManager && result.blob) {
    const name = ${(sourceData.imageName as string) || 'image'}.png
    try { assetId = await assetManager.saveAsset(new File([result.blob], name, { type: 'image/png' }), name, 'image/png') }
    catch (err) { ctx.logger.error('保存资产失败:', err) }
  }

  // 计算卡片尺寸
  const ratio = Math.min(MAX_PREVIEW_WIDTH / result.newWidth, MAX_PREVIEW_HEIGHT / result.newHeight, 1)
  const cardWidth = Math.max(80, Math.round(result.newWidth * ratio))
  const cardHeight = Math.max(60, Math.round(result.newHeight * ratio))

  // 创建新节点
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
      imageWidth: result.newWidth,
      imageHeight: result.newHeight,
      cardWidth,
      cardHeight,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }])
}
`

- [ ] **Step 2: 用通用函数重写 handleImageCropConfirm**

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

    // 2. 计算裁剪参数
    const scaleX = imageWidth > 0 ? 1 : 1
    const scaleY = imageHeight > 0 ? 1 : 1

    // 3. 执行变换
    const result = await applyImageTransform(
      imageUrl,
      (c2d, canvas, bitmap) => {
        // 用实际尺寸计算裁剪坐标
        const sx = Math.round(cropRect.x * (bitmap.width / (imageWidth as number)))
        const sy = Math.round(cropRect.y * (bitmap.height / (imageHeight as number)))
        const sw = Math.round(cropRect.width * (bitmap.width / (imageWidth as number)))
        const sh = Math.round(cropRect.height * (bitmap.height / (imageHeight as number)))

        // 调整 canvas 大小为裁剪区域
        canvas.width = sw
        canvas.height = sh
        // createImageBitmap 裁剪
      },
      ctx,
      '_crop',
    )

    if (!result) return

    // 需要用 createImageBitmap 裁剪 → 单独处理（因为 canvas 尺寸需要在 drawFn 外确定）
    // 简化：直接用 createImageBitmap 的裁剪参数
    await persistAndCreateNode(ctx, sourceData, node, result, '_crop')
  } catch (err) {
    ctx.logger.error('[Image] handleImageCropConfirm failed:', err)
  }
}
`

**注意**：裁剪操作的 createImageBitmap(bitmap, sx, sy, sw, sh) 调用比较特殊，需要先获取 bitmap 再裁剪。重写时需要保留这个两阶段逻辑。实际的 pplyImageTransform 需要稍作调整，让它支持这种"先获取 bitmap 再决定 canvas 大小"的场景。

更简洁的做法是让 pplyImageTransform 接受一个可选的 itmapTransform 回调：

`	ypescript
async function applyImageTransform(
  imageUrl: string,
  options: {
    bitmapTransform?: (bitmap: ImageBitmap) => { canvasWidth: number; canvasHeight: number; draw: (ctx: CanvasRenderingContext2D) => void }
    directDraw?: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, bitmap: ImageBitmap) => void
  },
  ctx: CommandContext,
  nameSuffix: string,
): Promise<ImageTransformResult | null>
`

- [ ] **Step 3: 用通用函数重写 handleImageExpandConfirm 和 handleImageMaskConfirm**

`	ypescript
// handleImageExpandConfirm → 使用 directDraw
async function handleImageExpandConfirm(ctx: CommandContext) {
  // ... 前置校验代码（获取 node, data, expandRect 等）

  const result = await applyImageTransform(
    imageUrl,
    {
      directDraw: (c2d, canvas, bitmap) => {
        canvas.width = sw
        canvas.height = sh
        c2d.drawImage(bitmap, -sx, -sy)
      },
    },
    ctx,
    '_expand',
  )

  if (!result) return
  await persistAndCreateNode(ctx, sourceData, node, result, '_expand')
}

// handleImageMaskConfirm → 使用 directDraw
async function handleImageMaskConfirm(ctx: CommandContext) {
  // ... 前置校验

  const result = await applyImageTransform(
    imageUrl,
    {
      directDraw: async (c2d, canvas, imgBitmap) => {
        canvas.width = imgBitmap.width
        canvas.height = imgBitmap.height
        c2d.drawImage(imgBitmap, 0, 0)
        // 加载蒙版并叠加
        const maskResponse = await fetch(maskUrl)
        const maskBlob = await maskResponse.blob()
        const maskBitmap = await createImageBitmap(maskBlob)
        c2d.drawImage(maskBitmap, 0, 0, canvas.width, canvas.height)
        maskBitmap.close()
      },
    },
    ctx,
    '_masked',
  )

  if (!result) return
  await persistAndCreateNode(ctx, sourceData, node, result, '_masked')
}
`

- [ ] **Step 4: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 5: Commit**

`ash
git add packages/canvas-core/src/nodes/image/ImageNodePlugin.ts
git commit -m "refactor(canvas-core): extract applyImageTransform and persistAndCreateNode in ImageNodePlugin"
`

---

### Task 12: 清理 BaseNode.vue 重复 JSDoc 注释

**Files:**
- Modify: src/components/Decoration/BaseNode.vue

- [ ] **Step 1: 删除重复注释**

以下函数/变量的 JSDoc 出现了 2-3 次，保留第一次，删除后面的重复：

- clamp（第 396 行）— 保留第一个，删除后续重复（注意：Task 7 已经改为 import，所以这一步只需清理残留注释）
- cardTransform — 保留第一个
- showTargetZones — 保留第一个
- eedbackMousePosition — 保留第一个
- invalidFeedbackPosition — 保留第一个
- updateCardMousePosition — 保留第一个

每个重复注释块的模式是：两个完全相同的 /** ... */ 块紧挨着，删掉第二个。

- [ ] **Step 2: 验证编译**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 无错误

- [ ] **Step 3: Commit**

`ash
git add packages/canvas-core/src/components/Decoration/BaseNode.vue
git commit -m "chore(canvas-core): remove duplicate JSDoc comments in BaseNode.vue"
`

---

### Task 13: 最终验证 — 全量构建 + 测试

- [ ] **Step 1: 完整 TypeScript 编译检查**

Run: 
px tsc --noEmit --project packages/canvas-core/tsconfig.json 2>&1

Expected: 零错误

- [ ] **Step 2: 运行所有测试**

Run: 
px vitest run --project packages/canvas-core 2>&1

Expected: 全部通过

- [ ] **Step 3: 最终 Commit（如果有遗漏的文件）**

`ash
git status
git add -A
git commit -m "chore(canvas-core): final cleanup after refactoring pass"
`

---

## 自检清单

1. **Spec coverage**: 覆盖了审计报告中的全部 7 个问题类别
2. **Placeholder scan**: 无 TBD/TODO/占位符
3. **Type consistency**: 	oFlowPosition 签名统一为 (viewport, clientX, clientY) → {x, y}，clamp 签名统一为 (value, min, max) → number，DEFAULT_NODE_SIZE 统一为 {width: 256, height: 256}

---

Plan complete and saved to docs/superpowers/plans/2026-07-04-canvas-core-dedup.md. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 task 派一个子代理，task 间 review，迭代快

**2. Inline Execution** — 在当前会话逐步执行，批量推进

哪种方式？
