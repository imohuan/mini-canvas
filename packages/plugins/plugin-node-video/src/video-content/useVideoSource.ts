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

  /**
   * 只在引用/旧地址真的变了时重解析。
   *
   * 原来这里返回的是新建数组，父级任何一次 data 写盘都会让它"看起来变了"，
   * 于是重新 resolve 并给播放器换一次 src。底栏存盘循环期间视频也会被反复重载。
   */
  const sourceKey = computed(() => sourceFields.value.resourceId + '|' + sourceFields.value.legacyUrl)
  watch(sourceKey, refreshResolvedUrl, {
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
