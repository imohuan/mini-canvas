import { computed, ref, watch } from 'vue'
import { readVideoSourceFields, resolveVideoSrc, type ResourceResolverLike } from '../videoRefs'

/**
 * 视频来源与画面尺寸：把 resourceId / 旧 videoUrl 解析成当前可播放地址。
 *
 * 解析结果只留在内存里，不写回节点 data；换源时用 token 丢弃过期结果。
 */
export function useVideoSource(
  ctx: ResourceResolverLike | undefined,
  data: () => Record<string, unknown>,
) {
  const sourceFields = computed(() => readVideoSourceFields(data()))
  const resolvedUrl = ref(sourceFields.value.legacyUrl)
  let resolveToken = 0

  async function refreshResolvedUrl(): Promise<void> {
    const token = ++resolveToken
    resolvedUrl.value = sourceFields.value.legacyUrl
    const url = await resolveVideoSrc(ctx, data())
    if (token !== resolveToken) return
    resolvedUrl.value = url || sourceFields.value.legacyUrl
  }

  watch(() => [sourceFields.value.resourceId, sourceFields.value.legacyUrl], refreshResolvedUrl, {
    immediate: true,
  })

  const videoUrl = computed(() => resolvedUrl.value)
  const videoWidth = computed(() => (typeof data().videoWidth === 'number' ? data().videoWidth as number : 0))
  const videoHeight = computed(() => (typeof data().videoHeight === 'number' ? data().videoHeight as number : 0))

  return {
    sourceFields,
    resolvedUrl,
    refreshResolvedUrl,
    videoUrl,
    videoWidth,
    videoHeight,
  }
}
