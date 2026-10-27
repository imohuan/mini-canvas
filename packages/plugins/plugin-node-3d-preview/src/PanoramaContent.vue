<script setup lang="ts">
/**
 * PanoramaContent —— 3D 全景预览节点的 content 组件（随插件包发布，经 BaseNode 壳的 content 段渲染）。
 *
 * 对照老版 packages/canvas-core/src/nodes/panorama/PanoramaNode.vue：球体内壁贴一张图（等距柱状全景图），
 * 用相机朝向做"转头"效果。三条能力：
 * - 拖拽转视角（按住画面左右/上下拖动）；
 * - 滚轮缩放（改相机视野角）；
 * - 重置按钮（回到初始朝向）。
 *
 * 两种模式（用户要求："3D 预览节点这个地方也有 2 种模式的，也是双击进入，进入之后可以转动视角，
 * 默认模式下是用来拖拽节点的"）：
 * - **预览模式（默认）**：3D 画面不吃指针事件 → 按住画面拖动 = 拖动节点本身；
 * - **交互模式（双击进入）**：画面接管指针与滚轮 → 拖拽转视角 / 滚轮改视野角 / 重置按钮可用，
 *   且把滚轮拦下来（否则转视角时画布会跟着一起缩放）。Esc 或点画布空白退出，回到可拖节点状态。
 * 判定全在 panoramaMode.ts（纯函数、可单测）；模式会话在 panoramaSession.ts（按 nodeId 记名，
 * **不写 data** —— 写进去会落盘，刷新后一开画布就停在交互模式、连节点都拖不动）。
 *
 * 与老版的差异（v2 分层）：
 * - 不自带顶部工具栏/全屏/下载/上传按钮 —— 工具栏是节点壳的 top-toolbar 段，本包不抢壳的活；
 * - 老版用 data._editing 记"能不能转"（还得靠 sanitizeForSave 手动抠掉才不落盘），v2 换成会话态；
 * - 视角数学挪到 panoramaView.ts（可单测），贴图来源判定挪到 textureSource.ts（可单测）；
 * - 只读渲染上下文经 useCanvasRender() 取（宿主 provide），不反向依赖 demo/宿主。
 *
 * 资源回收：three 的场景/几何/材质/贴图/渲染器在卸载时逐个 dispose，避免 WebGL 上下文泄漏。
 */
import * as THREE from 'three'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RenderEvents, useCanvasRender, createUpstreamCapability, useUiComponent, type UpstreamCapability } from '@mini-canvas/canvas-render'
import {
  DEFAULT_VIEW,
  applyDrag,
  applyZoom,
  damp,
  resetView,
  toSpherical,
  type ViewState,
} from './panoramaView'
import { findUpstreamImageRef, resolveUpstreamImageFields, upstreamSourceFields } from './textureSource'
import { isDisplayUrl, resolveImageSrc } from './imageRefs'
import { buildUpstreamApiUrl, readUpstreamMediaPayload } from './upstreamApi'
import { shouldClearTexture, shouldShowTexture } from './textureLifecycle'
import { resolveEscapeAction, resolvePanoramaSpec } from './panoramaMode'
import { beginInteract, endInteract, exitFullscreen, isFullscreen, isInteracting, resetViewToken } from './panoramaSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx, renderEdges, renderNodes } = useCanvasRender()

/**
 * 统一空状态：默认主题登记在 ui 目录的 nodeEmptyState（图片/视频/音频/3D 共用）。
 * 没装主题/极简宿主时为空 → 模板里回落本组件自带的一行提示，不让节点白屏。
 */
const NodeEmptyState = useUiComponent('nodeEmptyState')

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
  const url = buildUpstreamApiUrl(template, { canvasId, nodeId: props.id })
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
        id: props.id,
        type: '3d-preview',
        data: computed(() => props.data ?? {}),
        selected: computed(() => false),
        solo: computed(() => false),
        zoom: computed(() => 1),
        update: () => {},
      } as never)
    }
  } catch {
    // 能力工厂坏了（宿主实现 bug）不应让整张卡片崩：退回同一个纯函数工厂。
  }
  return createUpstreamCapability(ctx, { id: props.id, type: '3d-preview' })
}

/** 画布 DOM 容器（three 的 canvas 挂这里） */
const hostRef = ref<HTMLDivElement | null>(null)
/** 当前贴的图地址（空 = 显示占位提示） */
const textureUrl = ref('')
/** 图上屏后置 true，用来收掉"未贴图"的占位与提示 */
const textureLoaded = ref(false)
/** 空状态判定：地址为空 / 还没加载完 / 渲染失败，三者任一成立都不算"有画面"。
 *  这是用户实测的"上游撤掉后旧图还挂着"的根因 —— 只看加载回调的布尔会漏掉"url 变空"。 */
const hasTexture = computed(() =>
  shouldShowTexture({ url: textureUrl.value, loaded: textureLoaded.value, error: renderError.value }),
)
/** 渲染失败（浏览器不支持 WebGL 等）时降级成文字提示，不让节点白屏 */
const renderError = ref('')
// 交互模式：来自会话（按 nodeId 记名，不写 data —— 写进去会落盘/进历史）
const interacting = computed(() => isInteracting(props.id))
// 全屏查看（f 切换）：同样来自会话
const fullscreen = computed(() => isFullscreen(props.id))
// 当前模式下的行为结论（是否接管指针/滚轮、提示文案、是否显示重置按钮）
const spec = computed(() =>
  resolvePanoramaSpec({
    interactive: interacting.value,
    fullscreen: fullscreen.value,
    hasError: !!renderError.value,
  }),
)

/** 全屏容器（three 的 canvas 在全屏时被搬到这里，退出时搬回节点内） */
const fullscreenHostRef = ref<HTMLDivElement | null>(null)
/** 是否正在拖拽（拖动时给手柄光标/禁用 canvas 原生手势） */
const dragging = ref(false)
// three 对象放 shallowRef：它们是重量级外部对象，不需要（也不该）被 Vue 深度代理
const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
const scene = shallowRef<THREE.Scene | null>(null)
const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
const material = shallowRef<THREE.MeshBasicMaterial | null>(null)
const geometry = shallowRef<THREE.SphereGeometry | null>(null)
const loadedTexture = shallowRef<THREE.Texture | null>(null)
const loader = shallowRef<THREE.TextureLoader | null>(null)

let frameId = 0
let resizeObserver: ResizeObserver | null = null
/** 贴图请求序号：每次换图 +1，回调里比对，防止"先发的慢图"把后发的新图盖掉 */
let textureToken = 0
/** 已注册的清理函数（卸载时统一跑） */
const cleanupFns: Array<() => void> = []
// 视角：target 是"想去的地方"，current 是"现在在哪"；每帧把 current 朝 target 平滑推近
let target: ViewState = { ...DEFAULT_VIEW }
let current: ViewState = { ...DEFAULT_VIEW }
let dragStart = { x: 0, y: 0, lon: 0, lat: 0 }

/**
 * 读一个主题变量当前的值（three 的 Color / 材质吃不到 CSS 变量，只能在运行时取一次）。
 * 取不到（无 DOM，如单测 SSR）就回落传入的兜底色 —— 与 CSS 里的兜底值同一套。
 */
function themeColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback
}
/* 无 DOM 时的兜底色（= node-theme.css 亮色默认值，与各处 CSS 兜底同值） */
const FALLBACK = { surface: '#f3f4f6', border: '#e5e7eb' } // 主题色白名单: 单测 SSR 无 DOM 读不到 CSS 变量，此处只是同值兜底

/**
 * 贴图来源：**上游优先**，没有上游才用节点自己的字段（与 v1 口径一致）。
 *
 * 优先走 `upstream` 能力（按本类型声明的 consumes.image 读上游）；
 * 极简宿主/单测没有能力包时，回落到按边扫描（迁移期实现，集中在本文件一处）。
 *
 * 地址与引用都接受：新节点只写 `resourceId`，旧节点只有 `imageUrl` —— 解析交给 imageRefs，
 * 本组件不再各写一份回退。
 */
const ownImageUrl = ref('')
let textureSourceToken = 0

/** 上游是否连了图（空态文案要用；异步解析回来前先保守显示空态） */
const hasUpstream = ref(false)

async function refreshTextureSource(): Promise<void> {
  const token = ++textureSourceToken
  const d = props.data ?? {}
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
    const legacy = findUpstreamImageRef(renderEdges.value, props.id, (nodeId) => {
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

watch(() => [props.data, renderEdges.value, renderNodes.value], refreshTextureSource, { immediate: true })

/** 把贴图换成 url 指定的图；空 url 表示撤掉贴图回到占位态 */
function updateTexture(url: string): void {
  const mat = material.value
  const ldr = loader.value
  if (!mat || !ldr) return
  const scn = scene.value
  const token = ++textureToken
  if (!url) {
    mat.map = null
    // 旧贴图也一并释放：只把 map 置空不 dispose，切换多次会累积 GPU 纹理（长会话可见内存上涨）。
    loadedTexture.value?.dispose()
    loadedTexture.value = null
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
    (tex) => {
      // 加载完成前可能已切到别的图 / 已卸载：丢弃过期结果。
      // 仅判 material 存在不够 —— 连换两张图时，第一张若后到会把第二张盖掉，故用序号比对。
      if (!material.value || token !== textureToken) {
        tex.dispose()
        return
      }
      loadedTexture.value?.dispose()
      loadedTexture.value = tex
      tex.colorSpace = THREE.SRGBColorSpace
      material.value.map = tex
      // 贴图颜色乘数：白色 = 原图不变，无需跟主题
      material.value.color.set('#ffffff') // 主题色白名单: 贴图乘数恒白，改色会污染原图
      material.value.needsUpdate = true
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

/**
 * 当前 canvas 实际所在的容器（在节点内 / 在全屏层）。
 * 尺寸测量与 ResizeObserver 都必须看**真正装着 canvas 的那个** ——
 * 全屏时 canvas 被搬到全屏层，若还量节点内的壳，就会按节点大小渲染一张铺不满的画面。
 */
function activeHost(): HTMLElement | null {
  return fullscreen.value ? fullscreenHostRef.value : hostRef.value
}

/** 容器当前像素尺寸（拿不到时给一个兜底值，避免 0 宽高导致 WebGL 报错） */
function containerSize(): { w: number; h: number } {
  const el = activeHost()
  if (!el) return { w: 640, h: 400 }
  const rect = el.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height }
  return { w: 640, h: 400 }
}

/** 每帧：把视角朝目标推近一点，再让相机看向对应方向并渲染一帧 */
function tick(): void {
  frameId = requestAnimationFrame(tick)
  const cam = camera.value
  const rnd = renderer.value
  const scn = scene.value
  if (!cam || !rnd || !scn) return

  current = {
    lon: damp(current.lon, target.lon, 0.1),
    lat: damp(current.lat, target.lat, 0.1),
    fov: damp(current.fov, target.fov, 0.1),
  }
  const { phi, theta } = toSpherical(current.lon, current.lat)
  const lookAt = new THREE.Vector3().setFromSphericalCoords(1000, phi, theta)
  cam.lookAt(lookAt)
  if (Math.abs(cam.fov - current.fov) > 0.01) {
    cam.fov = current.fov
    cam.updateProjectionMatrix()
  }
  rnd.render(scn, cam)
}

/** 按容器尺寸同步渲染器与相机（容器被 resize 时也要跟） */
function syncSize(): void {
  const rnd = renderer.value
  const cam = camera.value
  if (!rnd || !cam) return
  const { w, h } = containerSize()
  rnd.setSize(w, h, false)
  cam.aspect = w / h
  cam.updateProjectionMatrix()
}

/** 建 three 场景：反着贴图的大球（相机在球心往外看）+ 透视相机 */
function initThree(): void {
  const el = hostRef.value
  if (!el || renderer.value) return
  const { w, h } = containerSize()

  try {
    // alpha:true：没贴图时不画底色（透明），空态由壳的内容底决定（亮白/暗深）
    const rnd = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    rnd.setClearAlpha(0)
    rnd.setSize(w, h, false)
    rnd.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    rnd.domElement.style.cssText =
      'display:block;width:100%;height:100%;position:absolute;inset:0;cursor:grab'
    el.appendChild(rnd.domElement)

    const scn = new THREE.Scene()
    // 不设 scene.background：透明清屏，让节点的内容底透出来（贴图加载后由球体铺满）
    const cam = new THREE.PerspectiveCamera(current.fov, w / h, 0.1, 1100)
    cam.position.set(0, 0, 0)

    // 球翻面（scale(-1,1,1)）→ 我们从球心看到的是内壁，正好当全景幕布
    const geo = new THREE.SphereGeometry(1000, 64, 32)
    geo.scale(-1, 1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: themeColor('--canvas-node-border', FALLBACK.border) })
    scn.add(new THREE.Mesh(geo, mat))

    renderer.value = rnd
    scene.value = scn
    camera.value = cam
    geometry.value = geo
    material.value = mat
    loader.value = new THREE.TextureLoader()

    bindEvents(rnd.domElement)
    observeSize(el)
    updateTexture(textureUrl.value)
    tick()
  } catch (err) {
    renderError.value = err instanceof Error ? err.message : '3D 渲染不可用'
  }
}

/**
 * 监听容器尺寸变化（节点被 resize 拖动时尺寸会变）。
 * 搬迁容器时（进/出全屏）重新 observe：ResizeObserver 只认观察时给的那个元素，
 * 不重挂的话全屏层尺寸变化不会被感知。
 */
function observeSize(el: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return
  if (!resizeObserver) resizeObserver = new ResizeObserver(() => syncSize())
  resizeObserver.disconnect()
  resizeObserver.observe(el)
}

/** 绑交互：拖拽转视角 + 滚轮缩放。全部 stopPropagation，避免画布同时被拖动/缩放 */
function bindEvents(el: HTMLElement): void {
  const onPointerDown = (e: PointerEvent): void => {
    // 预览模式不接管指针：事件照常冒泡到节点，按住画面就是拖节点（用户要的默认行为）
    if (!spec.value.capturePointer) return
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging.value = true
    dragStart = { x: e.clientX, y: e.clientY, lon: target.lon, lat: target.lat }
    // 光标不在这里直接写 el.style：内联样式会盖住模板上按模式绑的 cursor（预览模式还给节点拖拽），
    // 统一交给模板 :style="...dragging ? 'grabbing' : 'grab'" 一处决定。
    el.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging.value) return
    e.preventDefault()
    e.stopPropagation()
    // 用相对按下点的位移重算，避免多次拖拽误差累积
    const next = applyDrag({ lon: dragStart.lon, lat: dragStart.lat, fov: target.fov }, e.clientX - dragStart.x, e.clientY - dragStart.y)
    target = { ...target, lon: next.lon, lat: next.lat }
  }
  const onPointerUp = (e: PointerEvent): void => {
    if (!dragging.value) return
    e.stopPropagation()
    dragging.value = false
    el.releasePointerCapture?.(e.pointerId)
  }
  const onWheel = (e: WheelEvent): void => {
    // 预览模式：滚轮归画布（缩放画布）；只有交互模式才抢过来改视野角
    if (!spec.value.captureWheel) return
    e.preventDefault()
    e.stopPropagation()
    target = applyZoom(target, e.deltaY)
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  // wheel 一律以"非被动"挂上：预览模式里它直接 return（不 preventDefault，画布照常缩放），
  // 交互模式才真正拦截。按模式增删监听器的代价是模式切换要动事件绑定，不值得。
  el.addEventListener('wheel', onWheel, { passive: false })
  cleanupFns.push(() => {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
    el.removeEventListener('wheel', onWheel)
  })
}

/** 重置视角（回到初始朝向与视野角） */
function onReset(): void {
  target = resetView()
}

/** 双击进入交互模式（预览态才有意义；失败态不进） */
function onDblClick(e: MouseEvent): void {
  if (spec.value.mode === 'error') return
  if (spec.value.interactive) return
  e.stopPropagation()
  beginInteract(props.id)
}

/** 退出交互模式（Esc / 点画布空白），回到"按住就能拖节点"的默认状态 */
function exitInteract(): void {
  endInteract(props.id)
  dragging.value = false
}

/**
 * 把 three 的 canvas 搬到当前该待的容器里（节点内 ↔ 全屏层）。
 *
 * 为什么搬而不是建两个渲染器：WebGL 上下文与贴图都在同一个 renderer 上，
 * 重建一份既慢又容易漏 dispose（贴图/几何全要重来）。搬 DOM 只需改尺寸并让相机重算宽高比。
 */
function relocateSurface(): void {
  const canvasEl = renderer.value?.domElement
  if (!canvasEl) return
  const target = activeHost()
  if (!target || canvasEl.parentElement === target) return
  target.appendChild(canvasEl)
  // 尺寸观察要跟着换成新容器，否则全屏层的尺寸变化不会被感知
  observeSize(target)
  syncSize()
}

/**
 * Esc 退出交互模式（全屏时先退全屏，再按一次退交互）。
 * 挂在 window 而不是画面元素上：进交互后焦点可能不在画面里，挂在元素上会出现"按 Esc 没反应"。
 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  // 一次只退一层（判定见 panoramaMode.resolveEscapeAction）：全屏 → 退回节点内仍可转视角 →
  // 再按一次才回到"按住就能拖节点"。有明确中间层，既不会一下跳回去，也不容易误退。
  const action = resolveEscapeAction({ fullscreen: fullscreen.value, interactive: interacting.value })
  if (action === 'exit-fullscreen') exitFullscreen(props.id)
  else if (action === 'exit-interact') exitInteract()
}

function disposeThree(): void {
  if (frameId) cancelAnimationFrame(frameId)
  frameId = 0
  for (const fn of cleanupFns.splice(0)) fn()
  resizeObserver?.disconnect()
  resizeObserver = null
  renderer.value?.dispose()
  renderer.value?.domElement.remove()
  geometry.value?.dispose()
  material.value?.dispose()
  loadedTexture.value?.dispose()
  renderer.value = null
  scene.value = null
  camera.value = null
  geometry.value = null
  material.value = null
  loadedTexture.value = null
  loader.value = null
}

onMounted(() => {
  textureUrl.value = ownImageUrl.value
  initThree()
  window.addEventListener('keydown', onKeydown)
})

// 全屏开关（f 命令改会话 → 这里把 canvas 搬进/搬出全屏层）
watch(fullscreen, async () => {
  await nextTick() // 等全屏容器渲染出来再搬
  relocateSurface()
})

// 「重置视角」命令信号（r 命令 → token +1 → 这里把相机拉回初始朝向）。
// 用 watch 而不是让命令直接调组件：命令与组件互不认识对方，靠会话计数器通信。
watch(
  () => resetViewToken(props.id),
  () => onReset(),
)

// 上游/自身图片变化 → 换贴图（画面容器由 textureUrl 同步决定，三处状态一起跟）
watch(ownImageUrl, (url) => {
  // 地址被撤掉时主动清掉旧纹理（这是"上游断开但画面还留着图"的直接修法）。
  if (shouldClearTexture(textureUrl.value, url)) textureLoaded.value = false
  if (renderer.value) updateTexture(url)
})


// 点画布空白退出交互（与 v1 的 paneClick 收起 _editing 同义）。
// 用内核事件桥而不是自己监听 document：宿主已经把"点空白"归一成 RenderEvents.PaneClick。
// 注意内核 on 返回的是 Disposable（不是取消函数），收尾要调 .dispose()。
const paneClickSub = ctx.on(RenderEvents.PaneClick, () => {
  if (interacting.value) exitInteract()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  paneClickSub.dispose()
  endInteract(props.id)
  disposeThree()
})
</script>

<template>
  <div class="pano" :data-mode="spec.mode" @dblclick.stop="onDblClick">
    <!-- three 的 canvas 挂这里。
         三个 VueFlow 保留类名把画布手势挡在外面：nodrag 不拖节点、nopan 不拖画布、
         nowheel 不缩放画布（否则滚轮会被 VueFlow 的 d3-zoom 吃掉，本节点的缩放失效）。
         事件里另做了 stopPropagation，与类名形成双保险。

         **两种模式的差别就在这三个类名有没有上**：
         - 预览模式（默认）什么都不加 → 指针事件穿透，按住画面 = 拖节点；
         - 交互模式（双击进入）加齐三个 → 拖拽转视角、滚轮改视野角、不拖节点/不拖画布/不缩画布。
         用类名切换而不是重绑事件，是为了让"模式"这一件事只有一个开关（spec），
         不给"某个监听忘了跟着切"留机会。 -->
    <div
      ref="hostRef"
      class="pano-surface"
      :class="{ 'nodrag nopan nowheel': spec.capturePointer }"
      :style="spec.capturePointer ? { cursor: dragging ? 'grabbing' : 'grab' } : { pointerEvents: 'none' }"
    />

    <!-- 没贴图时的空状态：默认只显示「空」，不再要求用户输入 URL。
         默认主题装了就复用统一的 NodeEmptyState（与图片/视频/音频同款）；
         极简宿主没装主题时回落一行灰字，保证仍有可读反馈。 -->
    <!-- 空态完全走默认组件的默认 UI：不传自定义图标，不传 tone，观感与图片/视频/音频一致 -->
    <NodeEmptyState
      v-if="!hasTexture && NodeEmptyState"
      text="（无全景图）"
      :description="hasUpstream ? '上游图片暂时不可用' : '把图片节点连进来，就能查看 360° 全景'"
    />
    <div v-else-if="!hasTexture" class="pano-empty">
      <span class="pano-empty-text">{{ hasUpstream ? '上游图片暂时不可用' : '（无全景图）' }}</span>
    </div>

  </div>

  <!-- 全屏查看（f 切换）：three 的 canvas 在进入时被搬进这里，退出时搬回节点内。
       样式刻意保持纯黑无装饰 —— 用户要求删掉常驻提示（"会遮挡视线"），画面之外不放任何东西。 -->
  <Teleport to="body">
    <div v-if="fullscreen" ref="fullscreenHostRef" class="pano-fullscreen nodrag nopan nowheel" @dblclick.stop />
  </Teleport>
</template>

<style scoped>
/* 视觉对齐 docs/design/ui-style-guide.md：灰阶承载层级、圆角 8、图标按钮 28~32、动效 .18s + reduced-motion 降级 */
.pano {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  /* 不铺底色：空态/未出图时让壳的内容底透出来（--card-content-surface，亮色白 / 暗色深）。
     这里曾经写 var(--canvas-node-surface)（卡片表面灰），于是 3D 空态比同类节点灰一档 */
}
.pano-surface {
  position: absolute;
  inset: 0;
  touch-action: none;
}

/* 空态（主题没装统一空状态件时的兜底） */
.pano-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  padding: 12px;
  text-align: center;
}
.pano-empty-text {
  color: var(--canvas-node-text-muted, #9ca3af);
  /* 中文正文最低 12px */
  font-size: 12px;
  line-height: 1.5;
}

/* 全屏层（f 切换）：铺满视口、纯黑无装饰。
   里面不放任何提示/按钮 —— 用户明确要求删掉常驻文案（"会遮挡视线"），
   全屏时唯一的操作入口是键盘（f 切回、r 重置、Esc 退出）。 */
.pano-fullscreen {
  position: fixed;
  inset: 0;
  /* z-index 走画布层叠带变量（--layer-modal） */
  z-index: var(--layer-modal, 100000);
  background: #000; /* 主题色白名单: 全屏查看层刻意纯黑无装饰 */
  touch-action: none;
}

</style>
