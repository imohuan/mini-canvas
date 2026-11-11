import { computed, ref, type Component, type Ref } from "vue"
import { useUiComponent, uiComponentOutside } from "@plume-canvas/canvas-render"
import type { MediaViewerItem, MediaViewerProps } from "./types"

/** kind 归一化 + 预览注册件取用 + 多张清单/下标。 */
export function useMediaViewerSource(
  props: MediaViewerProps,
  item: Ref<MediaViewerItem | null>,
) {
  /**
   * kind 归一化：宿主可能传中文标签（生成历史的「图片/视频/音频/文本」），
   * 这里统一映射成内置渲染认的英文 kind —— 各接入方不必各自换算。
   */
  const KIND_ALIASES: Record<string, string> = { 图片: "image", 视频: "video", 音频: "audio", 文本: "text" }
  const kind = computed(() => KIND_ALIASES[item.value?.kind ?? ""] ?? item.value?.kind ?? "")

  /**
   * 三类媒体的**预览注册件**（audioPreview / videoPreview / textPreview，节点插件登记）。
   * 登记了就用它们（波形播放器 / 自绘控件 / 文本排版），没登记才回落原生标签 ——
   * 预览观感跟着插件实现走，这里不做第二套。
   */
  function tryUseComponent(name: string) {
    try {
      return useUiComponent(name)
    } catch {
      // 画布树外（资产抽屉 / 生成历史弹窗等）：useUiComponent 抛错（无 provide），
      // 但注册表本身是**全局单例**（宿主 ctx 上）—— 用树外取件入口照常拿到。
      // 这样树里树外取到的都是**同一个注册件**，各宿主不必再传 previewComponents。
      return ref(uiComponentOutside(name))
    }
  }
  const AudioPreview = computed(() => (props.previewComponents?.audioPreview as Component | undefined) ?? (tryUseComponent("audioPreview").value as Component | undefined))
  const VideoPreview = computed(() => (props.previewComponents?.videoPreview as Component | undefined) ?? (tryUseComponent("videoPreview").value as Component | undefined))
  const TextPreview = computed(() => (props.previewComponents?.textPreview as Component | undefined) ?? (tryUseComponent("textPreview").value as Component | undefined))

  // ===== 多图（宿主给 list 时才有） =====
  const list = computed<string[]>(() => (item.value?.list?.length ? item.value.list : item.value?.url ? [item.value.url] : []))
  const currentIdx = ref(0)
  const isMultiple = computed(() => list.value.length > 1)
  const currentUrl = computed(() => list.value[currentIdx.value] ?? "")
  const isImage = computed(() => kind.value === "image")
  /** 能缩放/平移的媒体（图片 + 视频）。音频/文本不参与变换。
   *  用户口径（2026-10-07）：**只有图片**参与缩放/平移（视频默认铺满已够大，不要那一排缩放按钮）。
   *  视频改用节点插件的 videoPreview（自带播放/进度/音量），底部控制条对视频不再出现。 */
  const canZoom = computed(() => isImage.value)

  /**
   * 底部控制条**常驻**（用户口径 2026-10-29：页码 + 下载是所有媒体都有的常驻项）。
   *
   * 中段工具按媒体类型给：
   *   · 图片：缩放 / 旋转 / 翻转 / 重置（可拖拽平移，所以有缩放与重置）；
   *   · 视频：旋转 / 翻转（不能缩放，但「镜像 / 旋转」保留；变换作用在视频舞台盒上）；
   *   · 音频 / 文本 / 其它：只有常驻的页码 + 下载。
   */
  const hasTools = computed(() => isImage.value || kind.value === "video")

  return {
    kind,
    AudioPreview,
    VideoPreview,
    TextPreview,
    list,
    currentIdx,
    isMultiple,
    currentUrl,
    isImage,
    canZoom,
    hasTools,
  }
}

