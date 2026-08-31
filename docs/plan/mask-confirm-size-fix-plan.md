# 图片蒙版确认后宽高错误修复计划

## 任务概述
图片节点点击「蒙版」绘制后点「确认」，生成的新图片节点宽高不正确（蒙版被拉伸/错位）。
需要以现有「裁剪 / 扩展」确认逻辑为基准，修复蒙版合成与输出节点的宽高。

## 根因分析
- 裁剪/扩展：交互坐标全部基于「原图像素坐标」（`imageWidth × imageHeight`），
  确认时 `scaleX/scaleY` 换算得到正确的原图裁剪/扩展区域，输出 `sw/sh` 为原图像素尺寸。
- 蒙版：`ImageMasker.vue` 里绘制画布（`drawCanvasRef`）的像素尺寸用的是「显示尺寸」
  `Math.round(d.dw) × Math.round(d.dh)`（object-contain 缩放后适应卡片的大小，远小于原图）。
  确认时 `handleImageMaskConfirm` 却把这张低分辨率蒙版 `drawImage(maskBitmap, 0, 0, canvas.width, canvas.height)`
  拉伸到原图尺寸叠加，导致蒙版错位、模糊，输出节点宽高与蒙版内容不匹配。

## 修复方案
让蒙版绘制画布直接使用「原图分辨率」作为像素尺寸，与裁剪/扩展对齐：

### 文件：`packages/canvas-core/src/nodes/image/ImageMasker.vue`
1. `setupCanvases`：画布 `bg/fg` 的 `width/height` 改为 `props.imageWidth` / `props.imageHeight`
   （不再用 `d.dw/d.dh`）。背景图 `drawImage(img, 0, 0, w, h)` 用原图分辨率 1:1 绘制。
2. `clientToCanvas`：屏幕坐标换算回原图坐标 —— 除以 `d.scale`（`scale = dw/iw`）。
   ```ts
   return {
     x: (clientX - rect.left - d.ox) / d.scale,
     y: (clientY - rect.top - d.oy) / d.scale,
   }
   ```
3. 画笔大小换算：`getBrushStyle` 里 `size` 改为 `cfg.brushSize / d.scale`
   （画布变大了，画笔要按同样比例放大，才能在屏幕上保持原粗细）。
   注意 `getBrushStyle` 目前无 `display` 依赖，需在读 `d.scale` 处补充。

### 文件：`packages/canvas-core/src/nodes/image/ImageNodePlugin.ts`
`handleImageMaskConfirm` 合成逻辑已是「原图分辨率 canvas + 蒙版 1:1 叠加」，
蒙版 blob 现在是原图分辨率后无需改动；但为稳妥，确认输出的宽高直接使用
`imgBitmap.width/height`（原图分辨率）不变，与裁剪/扩展输出语义一致。

## 验证方案
1. 构建通过：`pnpm build`（vue-tsc 类型检查 + vite build）。
2. 手动验证：上传一张大图（如 1920×1080）→ 蒙版 → 绘制 → 确认，
   新节点宽高应等于原图分辨率，蒙版位置与绘制时一致、不模糊、不拉伸。

## 风险
- 画笔粗细换算若遗漏 `scale`，画布变大后画笔会显得变细（视觉差异）。
- `resizeObserver` 触发 `setupCanvases(true)` 时 snapshot/restore 需继续正确工作
  （画布尺寸改为原图分辨率后，snapshot 保存的是原图分辨率 dataURL，restore 1:1 绘制，逻辑不变）。
