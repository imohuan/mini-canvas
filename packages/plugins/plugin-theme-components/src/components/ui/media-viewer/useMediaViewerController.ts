import { computed, onBeforeUnmount, onMounted, watch, type Ref } from "vue"
import { useBodyScrollLock } from "./useBodyScrollLock"
import { useImageViewer } from "./useImageViewer"
import { useMediaDownload } from "./useMediaDownload"
import { useMediaNavigation } from "./useMediaNavigation"
import { useMediaViewerKeyboard } from "./useMediaViewerKeyboard"
import { useMediaViewerSource } from "./useMediaViewerSource"
import type { MediaViewerEmits, MediaViewerItem, MediaViewerProps } from "./types"

/** 全屏预览入口的接线：不改模板/样式，只把状态与行为分到 media-viewer/ 下的模块。 */
export function useMediaViewerController(
  props: MediaViewerProps,
  emit: MediaViewerEmits,
  item: Ref<MediaViewerItem | null>,
) {
  const canRemove = computed(() => typeof props.onDelete === "function")
  const source = useMediaViewerSource(props, item)

  const image = useImageViewer({
    isImage: () => source.isImage.value,
  })
  const { resetTransform, zoomIn, zoomOut, rotateImg, toggleFlip } = image

  const navigation = useMediaNavigation({
    isMultiple: () => source.isMultiple.value,
    list: () => source.list.value,
    currentIdx: source.currentIdx,
    resetTransform,
    resetRotationAndFlip: () => {
      image.rotation.value = 0
      image.flip.value = false
    },
    emitIndex: (index) => emit("index", index),
  })
  const { prevImage, nextImage, videoTransformReset } = navigation

  const { download } = useMediaDownload({
    currentUrl: () => source.currentUrl.value,
    item: () => item.value,
  })

  function close(): void { emit("close") }
  function remove(): void {
    if (item.value && props.onDelete) props.onDelete(item.value)
  }

  const keyboard = useMediaViewerKeyboard({
    hasItem: () => !!item.value,
    close,
    prevImage,
    nextImage,
    canZoom: () => source.canZoom.value,
    hasTools: () => source.hasTools.value,
    zoomIn,
    zoomOut,
    resetTransform,
    rotateImg,
    toggleFlip,
  })
  const { handleKeydown } = keyboard

  const scrollLock = useBodyScrollLock()
  const { lockBodyOverflow, restoreBodyOverflow } = scrollLock

  onMounted(() => window.addEventListener("keydown", handleKeydown, true))
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleKeydown, true)
    restoreBodyOverflow()
  })

  /**
   * 打开时锁 body 滚动、从宿主给的 index 起步、变换归零；关闭恢复。
   *
   * ⚠️ 必须 immediate：宿主都是「有预览项才挂 MediaViewer」
   * （`<MediaViewer v-if="previewItem" :item="previewItem" />`，见生成历史 / 资产预览 / 底栏）。
   * 首次挂载时 item 已经有值，不带 immediate 的 watch 不会执行 —— 起始下标停在 0，
   * 点第二张、第三张都只显示列表第一张（用户 2026-11-06 实测）。
   * 只有宿主改成常驻挂载时才会"碰巧正常"，不能靠那个前提。
   */
  watch(
    item,
    (v) => {
      if (typeof document === "undefined") return
      if (v) {
        source.currentIdx.value = Math.min(Math.max(v.index ?? 0, 0), Math.max(source.list.value.length - 1, 0))
        emit("index", source.currentIdx.value)
        resetTransform()
        videoTransformReset()
        lockBodyOverflow()
      } else {
        restoreBodyOverflow()
      }
    },
    { immediate: true },
  )

  return {
    canRemove,
    ...source,
    ...image,
    prevImage,
    nextImage,
    download,
    close,
    remove,
    handleKeydown,
  }
}

