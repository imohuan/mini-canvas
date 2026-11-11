import { computed, nextTick, watch, type Ref } from 'vue'
import type { VideoOpsContext } from '../videoOps'
import {
  followedVideoCardSizePatch,
  videoCardSizePatch,
  type CardSizePatch,
} from '../videoFit'
import { readVideoMeta } from '../videoTransform'

export interface VideoCardSizeOptions {
  nodeId: () => string
  data: () => Record<string, unknown>
  ops: VideoOpsContext
  sourceFields: Ref<{ resourceId: string; legacyUrl: string }>
  onSourceChanged: () => void
  /**
   * 本节点是否正被拖动（可选）。
   *
   * 拖动中改卡片尺寸会让节点在指针下跳一下（用户实测报的「拖拽节点没有效果，
   * 得等平移缩放才恢复」）。所以拖动期间只记下真实宽高，尺寸等松手后再补。
   */
  dragging?: () => boolean
}

/**
 * 卡片尺寸：视频地址一变就量一次，量到就按画面比例显示。
 *
 * 挂载时也会量一次（拖入 / 打开旧画布都是"第一次拿到地址"）；
 * 播放器拿到 loadedmetadata 时走同一个写入口，两者都幂等。
 */
export function useVideoCardSize(options: VideoCardSizeOptions) {
  const { nodeId, data, ops, sourceFields, onSourceChanged, dragging } = options

  const sourceKey = computed(() => sourceFields.value.resourceId + '|' + sourceFields.value.legacyUrl)

  /** 上一次量尺寸的地址：同一地址不重复解码（loadedmetadata 与 URL 监听都会走到这里） */
  let measuredUrl = ''

  function syncCardSize(patch: CardSizePatch | null): void {
    if (!patch) return
    const current = ops.read(nodeId()) ?? data()
    // 派生尺寸不是用户动作：走 measured 写入（落盘、不进撤销栈，与图片节点同一口径）
    ops.writeMeasured?.(nodeId(), current, patch.size)
  }

  /**
   * 挂载时补算：推迟到 nextTick，让写入落在挂载完成之后。
   *
   * 用 followedVideoCardSizePatch 而不是 missingVideoCardSizePatch：
   * 后者只处理"卡片尺寸缺失"，而视频节点不允许手动 resize（resizable:false），
   * 卡片尺寸不是用户的自由选择，一旦被后台 / 脚本 / 旧数据写歪
   * （实测：440×260 的卡片装 1280×720 的 16:9 视频，画面被 contain 留黑边）
   * 就永远没人纠正。followed 版本本就幂等（比例正确时返回 null、一次都不写），
   * 挂载时整体重算一遍安全。
   */
  function mountSize(): void {
    void nextTick(() => syncCardSize(followedVideoCardSizePatch(data(), ops.fitLimits?.())))
  }

  watch(sourceKey, () => {
    onSourceChanged()
    measuredUrl = ''
    syncCardSize(followedVideoCardSizePatch(data(), ops.fitLimits?.()))
  })

  /**
   * 显示的 URL 变了：先量一次视频尺寸，量到就按尺寸显示宽高。
   *
   * 用户口径（2026-11-11）：「监听它显示的 URL 的变化，一变就先取尺寸，再按尺寸显示」。
   * 拖入 / 换源 / 旧数据打开都走这一条；量不到（跨域、编码不支持）就什么都不做。
   */
  async function measure(url: string): Promise<void> {
    if (!url || url === measuredUrl) return
    measuredUrl = url
    const meta = await readVideoMeta(url).catch(() => null)
    // 量的时候地址又换了 → 这次结果作废（新地址那一次自己会量）
    if (url !== measuredUrl) return
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
      // 失败不记住：下次地址再变/再挂载还能重试
      measuredUrl = ''
      return
    }
    flushMeta(meta.width, meta.height)
  }

  /** 拖动中拿到、还没落地的真实宽高（松手后补写） */
  let pendingMeta: { width: number; height: number } | null = null

  /**
   * 视频元数据到手：**记下真实宽高，并让卡片跟着视频比例**。
   *
   * 用户 2026-11-11 实测（从资源面板拖入视频）：卡片先按类型默认 480×320 画出来，
   * 视频是 1280×720，上下各留一条黑边；要平移缩放一次才恢复。
   * 根因是旧实现只在「卡片还没有尺寸」时才写回 —— 而拖入时卡片**已经有**默认尺寸，
   * 真实宽高就被丢掉了。视频节点不允许手动 resize，卡片尺寸本就该由画面比例决定，
   * 所以这里和挂载兜底同一条口径：比例不对就纠正（幂等，算出来一样就一次都不写）。
   */
  function onMeta(v: { videoWidth: number; videoHeight: number }): void {
    const w = v.videoWidth
    const h = v.videoHeight
    if (!(w > 0 && h > 0)) return
    pendingMeta = { width: w, height: h }
    flushMeta(w, h)
  }

  /** 宽高落到 data 与卡片尺寸（拖动中先攒着，松手再写） */
  function flushMeta(width?: number, height?: number): void {
    if (dragging?.() === true) return
    const w = width ?? pendingMeta?.width
    const h = height ?? pendingMeta?.height
    if (w === undefined || h === undefined) return
    if (!(w > 0 && h > 0)) return
    pendingMeta = null
    const current = ops.read(nodeId()) ?? data()
    // 宽高与卡片尺寸一起写：缺了宽高，后续按比例算卡片、裁剪换算都无从下手。
    const patch = videoCardSizePatch(w, h, ops.fitLimits?.())
    const sameMeta = positiveNum(current.videoWidth) === w && positiveNum(current.videoHeight) === h
    const sameSize =
      patch === null ||
      (positiveNum(current.cardWidth) === patch.size.w && positiveNum(current.cardHeight) === patch.size.h)
    if (sameMeta && sameSize) return
    // 测量结果不是用户动作：走 measured 写入（落盘、不进撤销栈）
    ops.writeMeasured?.(nodeId(), { ...current, videoWidth: w, videoHeight: h }, patch?.size)
  }

  if (dragging) watch(dragging, (on) => { if (!on) flushMeta() })

  return {
    mountSize,
    onMeta,
    measure,
  }
}

function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
