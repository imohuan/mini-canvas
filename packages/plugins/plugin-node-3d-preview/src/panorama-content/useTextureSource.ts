/**
 * 贴图来源与贴图更新。
 *
 * 原 PanoramaContent.vue 的 currentCanvasId / fetchUpstreamFromApi / upstreamOf /
 * refreshTextureSource / updateTexture 原样迁移；上游优先、能力其次、按边扫描兜底
 * 的判断顺序不变；「上游/自身图片变化」的 watch 也在本模块建立，入口按原顺序调用。
 */
import { computed, ref, watch, type Ref } from 'vue'
import { createUpstreamCapability, type CanvasRenderContext, type UpstreamCapability } from '@mini-canvas/canvas-render'
import { findUpstreamImageRef, resolveUpstreamImageFields, upstreamSourceFields } from '../textureSource'
import { isDisplayUrl, resolveImageSrc } from '../imageRefs'
import { buildUpstreamApiUrl, readUpstreamMediaPayload } from '../upstreamApi'
import { SRGBColorSpace } from 'three'
import type { PanoramaThreeState, Texture } from './threeState'

export interface TextureSourceOptions {
  id: string
  /** 节点 data 的现读入口（父组件可能整体替换 data，不能在 setup 时缓存旧对象） */
  data: () => Record<string, unknown>
  ctx: CanvasRenderContext['ctx']
  renderEdges: CanvasRenderContext['renderEdges']
  renderNodes: CanvasRenderContext['renderNodes']
  three: PanoramaThreeState
  textureLoaded: Ref<boolean>
  renderError: Ref<string>
  /** 主题变量读取（无 DOM 时回落兜底色） */
  themeColor: (varName: string, fallback: string) => string
  /** 无 DOM 时的兜底色 */
  fallback: { surface: string; border: string }
}

export interface TextureSourceApi {
  textureUrl: Ref<string>
  ownImageUrl: Ref<string>
  hasUpstream: Ref<boolean>
  refreshTextureSource: () => Promise<void>
  updateTexture: (url: string) => void
  /** 建立「上游/自身图片变化 → 换贴图」的 watch（入口按原顺序调用） */
  watchTextureSource: () => void
}

export function useTextureSource(options: TextureSourceOptions): TextureSourceApi {
  const { id, data, ctx, renderEdges, renderNodes, three, textureLoaded, renderError, themeColor, fallback: FALLBACK } = options

  /** 当前贴的图地址（空 = 显示占位提示） */
  const textureUrl = ref('')

  /** 贴图请求序号：每次换图 +1，回调里比对，防止"先发的慢图"把后发的新图盖掉 */
  let textureToken = 0

  const ownImageUrl = ref('')
  let textureSourceToken = 0

  /** 上游是否连了图（空态文案要用；异步解析回来前先保守显示空态） */
  const hasUpstream = ref(false)

  /** 当前画布 id（新上游接口的必填上下文）：URL 查询 ?canvas= 优先，其次哈希路由 #/canvas/<id> */
  function currentCanvasId(): string {
    if (typeof location === 'undefined') return ''
    try {
      const href = location.href
      const query = new URL(href).searchParams.get('canvas')
      if (query) return query
      const m = /#\/canvas\/([^/?#]+)/.exec(href)
      return m ? decodeURIComponent(m[1]) : ''
    } catch {
      return ''
    }
  }

  /**
   * 走**新接口**读上游资源（用户 2026-10-27：上游配置已换成一个单独的新 API）。
   *
   * 接口地址来自设置「常规/上游接口」，支持 {canvasId}/{nodeId}；留空返回 null（不用接口）。
   * 请求失败 / 返回认不出都返回 null，由调用方回落节点字段 —— 接口只是"更准的来源"，
   * 不是唯一真相（它没配、挂了、或还在灰度时不至于让已有画布变空白）。
   */
  async function fetchUpstreamFromApi(): Promise<Record<string, unknown> | null> {
    // ctx 在极简宿主里可能只有 get（没有 tryGet）：两种都试，不能因为缺一个方法整段跳过。
    const ctxAny = ctx as unknown as {
      tryGet?: (name: string) => unknown
      get?: (name: string) => unknown
    }
    const settings = (ctxAny.tryGet?.('settings') ?? ctxAny.get?.('settings')) as
      | { get?(key: string): unknown }
      | undefined
    const template = settings?.get?.('preview3dUpstreamApi')
    if (typeof template !== 'string' || !template.trim()) return null
    const canvasId = currentCanvasId()
    const url = buildUpstreamApiUrl(template, { canvasId, nodeId: id })
    if (!url) return null
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      const media = readUpstreamMediaPayload(await res.json())
      return media ? upstreamSourceFields(media) : null
    } catch {
      return null
    }
  }

  /**
   * 上游读取：优先走宿主注册的 `upstream` 能力（按本类型的 consumes.image）；
   * 没有能力包（极简宿主/单测）时，用同一个工厂按需造一份 —— 不重复实现扫边逻辑。
   */
  function upstreamOf(): UpstreamCapability {
    // 优先用宿主注册的能力实现；**不能**在这里无条件造一个新的 ——
    // 极简宿主/单测没有 capability 场时，createUpstreamCapability 仍能按 doc 现读，
    // 但旧宿主可能连 doc 都没有：两者都走同一个纯函数入口，由它按「读不到 = 没有上游」处理。
    const field = ctx?.registryOf?.('capability')
    const factory = field?.top?.('upstream')?.value
    try {
      if (typeof factory === 'function') {
        return factory({
          ctx,
          id,
          type: '3d-preview',
          data: computed(() => data() ?? {}),
          selected: computed(() => false),
          solo: computed(() => false),
          zoom: computed(() => 1),
          update: () => {},
        } as never)
      }
    } catch {
      // 能力工厂坏了（宿主实现 bug）不应让整张卡片崩：退回同一个纯函数工厂。
    }
    return createUpstreamCapability(ctx, { id, type: '3d-preview' })
  }

  async function refreshTextureSource(): Promise<void> {
    const token = ++textureSourceToken
    const d = data() ?? {}
    const ownData: Record<string, unknown> = {}
    // 空串不收：`{resourceId: ''}` 会让下游按"有引用"走解析分支，反而丢掉旧 imageUrl。
    if (typeof d.resourceId === 'string' && d.resourceId.trim()) ownData.resourceId = d.resourceId.trim()
    if (typeof d.imageUrl === 'string' && d.imageUrl.trim()) ownData.imageUrl = d.imageUrl.trim()
    // 旧存档里的全景图只写在 panoUrl（v1 遗物）：它可能是资源引用，也可能本身就是地址。
    // 按形状分派，**不能**一律塞进 resourceId —— 塞错会让资源服务把一个地址当 ID 查、最后变空图。
    if (typeof d.panoUrl === 'string' && d.panoUrl.trim() && !ownData.imageUrl) {
      if (isDisplayUrl(d.panoUrl.trim())) ownData.imageUrl = d.panoUrl.trim()
      else if (!ownData.resourceId) ownData.resourceId = d.panoUrl.trim()
    }
    // 1) 新接口优先（用户配置了才请求）；2) 宿主 upstream 能力；3) 极简宿主按边扫描。
    //    三层都只交"引用/地址"，真正解析仍统一走 resolveImageSrc。
    let sourceData: Record<string, unknown> | undefined = (await fetchUpstreamFromApi()) ?? undefined
    if (token !== textureSourceToken) return
    if (!sourceData) {
      let media: { resourceId?: unknown; url?: unknown } | null = null
      try {
        media = upstreamOf().media('image') ?? null
      } catch {
        media = null
      }
      // 能力读不到（宿主未注册/旧宿主）时，仍按边读上游节点自己的字段：
      // 新节点可能只写 resourceId，旧节点可能只有 imageUrl —— 两边都要算「有图」。
      const legacy = findUpstreamImageRef(renderEdges.value, id, (nodeId) => {
        const n = renderNodes.value.find((item) => item.id === nodeId)
        return n?.data as Record<string, unknown> | undefined
      })
      sourceData = resolveUpstreamImageFields({ media, legacy }) ?? undefined
    }
    hasUpstream.value = Boolean(sourceData)
    // 上游优先：它一旦有引用/地址就压过节点自身
    const finalSource = sourceData ?? ownData
    const resolved = await resolveImageSrc(ctx, finalSource)
    if (token !== textureSourceToken) return
    ownImageUrl.value = resolved
  }

  /** 把贴图换成 url 指定的图；空 url 表示撤掉贴图回到占位态 */
  function updateTexture(url: string): void {
    const mat = three.material.value
    const ldr = three.loader.value
    if (!mat || !ldr) return
    const scn = three.scene.value
    const token = ++textureToken
    if (!url) {
      mat.map = null
      // 旧贴图也一并释放：只把 map 置空不 dispose，切换多次会累积 GPU 纹理（长会话可见内存上涨）。
      three.loadedTexture.value?.dispose()
      three.loadedTexture.value = null
      // three 吃不到 CSS 变量：运行时按主题读一次占位色（与节点表面色同源）
      mat.color.set(themeColor('--canvas-node-border', FALLBACK.border))
      mat.needsUpdate = true
      // 空态：连球体一起藏掉，画布完全透明（只剩壳的底色）
      if (scn && scn.children[0]) scn.children[0].visible = false
      textureLoaded.value = false
      return
    }
    // 换图期间先标记"未就绪"：宁可持续显示空态，也不要挂着上一张图冒充新图。
    textureLoaded.value = false
    if (scn && scn.children[0]) scn.children[0].visible = false
    ldr.load(
      url,
      // three 的类型在本仓库里是本地 shim（any），回调参数不注解会触发 noImplicitAny。
      // 标成 THREE.Texture 既消掉报错，也把「这里拿到的是贴图」这层意思写清楚。
      (tex: Texture) => {
        // 加载完成前可能已切到别的图 / 已卸载：丢弃过期结果。
        // 仅判 material 存在不够 —— 连换两张图时，第一张若后到会把第二张盖掉，故用序号比对。
        if (!three.material.value || token !== textureToken) {
          tex.dispose()
          return
        }
        three.loadedTexture.value?.dispose()
        three.loadedTexture.value = tex
        tex.colorSpace = SRGBColorSpace
        three.material.value.map = tex
        // 贴图颜色乘数：白色 = 原图不变，无需跟主题
        three.material.value.color.set('#ffffff') // 主题色白名单: 贴图乘数恒白，改色会污染原图
        three.material.value.needsUpdate = true
        if (scn && scn.children[0]) scn.children[0].visible = true
        textureLoaded.value = true
        renderError.value = ''
      },
      undefined,
      () => {
        if (token !== textureToken) return
        // 图加载失败（会话级 objectURL 刷新后失效等）：回到占位态而非破图
        textureLoaded.value = false
        renderError.value = ''
      },
    )
  }

  function watchTextureSource(): void {
    watch(() => [data(), renderEdges.value, renderNodes.value], refreshTextureSource, { immediate: true })
  }

  return {
    textureUrl,
    ownImageUrl,
    hasUpstream,
    refreshTextureSource,
    updateTexture,
    watchTextureSource,
  }
}
