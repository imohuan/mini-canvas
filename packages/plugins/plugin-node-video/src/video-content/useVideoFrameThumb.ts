import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import type { FrameResourcePort } from '../videoThumbCanvas'
import {
  readVideoThumbTiers,
  resolveVideoThumbTier,
  videoThumbTargetFor,
  videoThumbTierKeys,
  type VideoThumbTierConfig,
} from '../videoThumbTier'
import { unifiedThumbOf } from '../videoThumbUnified'

interface VideoFrameThumbOptions {
  ctx: CanvasRenderContext['ctx']
  viewport: Readonly<Ref<{ zoom: number }>>
  videoUrl: Ref<string>
  videoWidth: Ref<number>
  videoHeight: Ref<number>
}

const TIER_PREFIX = 'video'

/**
 * 统一缩略图与缩放档位：按资源库缓存取整幅原片的一帧，未播放时只显示这张图。
 */
export function useVideoFrameThumb(options: VideoFrameThumbOptions) {
  const { ctx, viewport, videoUrl, videoWidth, videoHeight } = options
  const tierCfg = ref<VideoThumbTierConfig>(readVideoThumbTiers(TIER_PREFIX, ctx))
  const tierSettingOff = ctx
    ?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
    ?.onChange((key) => {
      if (!videoThumbTierKeys(TIER_PREFIX).includes(key)) return
      tierCfg.value = readVideoThumbTiers(TIER_PREFIX, ctx)
    })

  const zoom = computed(() => Math.max((viewport.value?.zoom ?? 1) || 1, 0.01))
  const canvasMinZoom = computed(() => ctx?.get<{ get(k: string): unknown }>('settings')?.get('minZoom'))
  const tier = computed(() => resolveVideoThumbTier(zoom.value, tierCfg.value, canvasMinZoom.value))

  const unifiedThumb = ref<string>('')
  const thumbLoading = ref(true)
  watch(
    [
      videoUrl,
      () => videoWidth.value,
      () => videoHeight.value,
      tier,
      () => tierCfg.value.tier2Width,
      () => tierCfg.value.tier2Height,
      () => tierCfg.value.tier3Width,
      () => tierCfg.value.tier3Height,
      () => tierCfg.value.quality,
    ],
    async () => {
      const src = videoUrl.value
      if (!src) { unifiedThumb.value = ''; thumbLoading.value = false; return }
      thumbLoading.value = true
      try {
        const wantTier = tier.value
        const box = videoThumbTargetFor(wantTier, tierCfg.value, {
          width: videoWidth.value,
          height: videoHeight.value,
        })
        /**
         * 失败重试（2026-11-07 修白屏）：第一次截帧失败（视频还没缓冲好 /
         * 网络抖动）就返回 null。以前这里直接认输，节点上永远空着；
         * 现在等一小会儿再试两次 —— 命中一次就有图，全失败才真的放弃。
         */
        let url: string | null = null
        for (let attempt = 0; attempt < 3 && !url; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 400))
          url = await unifiedThumbOf(src, frameResources(), {
            tier: wantTier,
            width: box.width,
            height: box.height,
            quality: tierCfg.value.quality,
            frameWidth: videoWidth.value,
            frameHeight: videoHeight.value,
          })
        }
        unifiedThumb.value = url ?? ''
      } catch {
        unifiedThumb.value = ''
      } finally {
        thumbLoading.value = false
      }
    },
    { immediate: true },
  )

  const posterDisplaySrc = computed(() => unifiedThumb.value)

  /** 资源库端口：帧图存这儿，换会话/换设备才有得复用 */
  function frameResources(): FrameResourcePort | undefined {
    const port = ctx?.get<FrameResourcePort | undefined>('resources')
    return port && typeof port.put === 'function' && typeof port.resolve === 'function' ? port : undefined
  }

  /** 缓存里的 objectURL 不是挂载时创建的 → 必须显式 fetch + decode */
  function prefetchPoster(): void {
    if (typeof fetch !== 'function') return
    void nextTick(() => {
      const url = posterDisplaySrc.value
      if (url) fetch(url, { cache: 'force-cache' }).catch(() => { })
    })
  }

  function dispose(): void {
    tierSettingOff?.dispose()
  }

  return {
    tierCfg,
    tier,
    unifiedThumb,
    thumbLoading,
    posterDisplaySrc,
    prefetchPoster,
    dispose,
  }
}
