import type { Node } from '@vue-flow/core'

type SourceNode = Pick<Node, 'id' | 'position' | 'data'>

export interface ClipRangeInput {
  start: number
  end: number
  duration: number
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface CapturedFrame {
  url: string
  width: number
  height: number
  assetId?: string
  at: number
}

export interface VideoResultOptions {
  suffix: string
  cropRect?: RectLike
  clipStart?: number
  clipEnd?: number
}

const DEFAULT_VIDEO_SIZE = { cardWidth: 480, cardHeight: 320 }
const DEFAULT_IMAGE_SIZE = { cardWidth: 420, cardHeight: 300 }

export function fitVideoCardSize(width: unknown, height: unknown, max = { cardWidth: 560, cardHeight: 360 }) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return DEFAULT_VIDEO_SIZE
  return fitSize(w, h, max)
}

function fitSize(width: unknown, height: unknown, max = DEFAULT_IMAGE_SIZE) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!w || !h) return max
  const ratio = Math.min(max.cardWidth / w, max.cardHeight / h, 1)
  return {
    cardWidth: Math.max(120, Math.round(w * ratio)),
    cardHeight: Math.max(80, Math.round(h * ratio)),
  }
}

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function clampClipRange({ start, end, duration }: ClipRangeInput) {
  const dur = Math.max(0.1, Number(duration) || 0.1)
  let s = Math.min(Math.max(0, Number(start) || 0), dur)
  let e = Math.min(Math.max(0, Number(end) || dur), dur)
  if (s > e) [s, e] = [e, s]
  if (s === e) e = Math.min(dur, s + 0.1)
  return { start: Number(s.toFixed(3)), end: Number(e.toFixed(3)) }
}

export function makeImageNodeFromFrame(sourceNode: SourceNode, frame: CapturedFrame): Node {
  const sourceData = sourceNode.data || {}
  const size = fitSize(frame.width, frame.height, DEFAULT_IMAGE_SIZE)
  const baseName = String(sourceData.videoName || sourceData.label || 'video').replace(/\.[^.]+$/, '')
  return {
    id: `image-frame-${Date.now()}`,
    type: 'custom',
    position: {
      x: sourceNode.position.x + (Number(sourceData.cardWidth) || DEFAULT_VIDEO_SIZE.cardWidth) + 40,
      y: sourceNode.position.y,
    },
    data: {
      label: `${baseName}_frame_${formatTime(frame.at).replace(':', '-')}.png`,
      nodeType: 'image',
      assetId: frame.assetId,
      imageUrl: frame.url,
      imageName: `${baseName}_frame.png`,
      imageType: 'image/png',
      imageWidth: frame.width,
      imageHeight: frame.height,
      cardWidth: size.cardWidth,
      cardHeight: size.cardHeight,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }
}

export function makeVideoResultNode(sourceNode: SourceNode, options: VideoResultOptions): Node {
  const sourceData = sourceNode.data || {}
  const crop = options.cropRect
  const cropSourceWidth = crop ? Number(sourceData.cropSourceWidth || sourceData.videoWidth) || crop.width : undefined
  const cropSourceHeight = crop ? Number(sourceData.cropSourceHeight || sourceData.videoHeight) || crop.height : undefined
  const width = crop?.width ?? sourceData.videoWidth
  const height = crop?.height ?? sourceData.videoHeight
  const size = fitVideoCardSize(width, height)
  const clip = options.clipStart !== undefined || options.clipEnd !== undefined
    ? clampClipRange({
        start: options.clipStart ?? 0,
        end: options.clipEnd ?? Number(sourceData.videoDuration),
        duration: Number(sourceData.videoDuration),
      })
    : null
  const baseName = String(sourceData.videoName || sourceData.label || 'video').replace(/\.[^.]+$/, '')
  const data = { ...sourceData }
  delete data._overlay
  return {
    id: `video-${Date.now()}`,
    type: 'custom',
    position: {
      x: sourceNode.position.x + (Number(sourceData.cardWidth) || DEFAULT_VIDEO_SIZE.cardWidth) + 40,
      y: sourceNode.position.y,
    },
    data: {
      ...data,
      label: `${baseName}${options.suffix}`,
      nodeType: 'video',
      videoName: `${baseName}${options.suffix}`,
      videoWidth: width,
      videoHeight: height,
      videoDuration: clip ? Math.max(0.1, Number((clip.end - clip.start).toFixed(3))) : sourceData.videoDuration,
      cardWidth: size.cardWidth,
      cardHeight: size.cardHeight,
      cropRect: crop,
      cropSourceWidth,
      cropSourceHeight,
      clipStart: clip?.start,
      clipEnd: clip?.end,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }
}
