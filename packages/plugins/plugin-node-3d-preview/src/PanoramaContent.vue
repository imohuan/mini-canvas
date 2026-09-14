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
import { RenderEvents, useCanvasRender } from '@mini-canvas/canvas-render'
import {
  DEFAULT_VIEW,
  applyDrag,
  applyZoom,
  damp,
  resetView,
  toSpherical,
  type ViewState,
} from './panoramaView'
import { findUpstreamImageUrl, pickTextureUrl } from './textureSource'
import { resolveEscapeAction, resolvePanoramaSpec } from './panoramaMode'
import { beginInteract, endInteract, exitFullscreen, isFullscreen, isInteracting, resetViewToken } from './panoramaSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx, renderEdges, renderNodes } = useCanvasRender()

/** 画布 DOM 容器（three 的 canvas 挂这里） */
const hostRef = ref<HTMLDivElement | null>(null)
/** 当前贴的图地址（空 = 显示占位提示） */
const textureUrl = ref('')
/** 图上屏后置 true，用来收掉"未贴图"的占位与提示 */
const hasTexture = ref(false)
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
/** 空态里手填的图片地址草稿 */
const draftUrl = ref('')

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

/** 从画布边里找连到本节点的上游图片；没有就用节点自身的 imageUrl / panoUrl */
const ownImageUrl = computed<string>(() => {
  const d = props.data ?? {}
  const own = (d.imageUrl as string) || (d.panoUrl as string) || ''
  const edges = renderEdges.value
  const nodes = renderNodes.value
  const upstream = findUpstreamImageUrl(edges, props.id, (nodeId) => {
    const n = nodes.find((item) => item.id === nodeId)
    return n?.data as Record<string, unknown> | undefined
  })
  return pickTextureUrl(own, upstream)
})

/** 把贴图换成 url 指定的图；空 url 表示撤掉贴图回到占位态 */
function updateTexture(url: string): void {
  const mat = material.value
  const ldr = loader.value
  if (!mat || !ldr) return
  const token = ++textureToken
  if (!url) {
    mat.map = null
    mat.color.set('#e5e7eb')
    mat.needsUpdate = true
    hasTexture.value = false
    return
  }
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
      material.value.color.set('#ffffff')
      material.value.needsUpdate = true
      hasTexture.value = true
      renderError.value = ''
    },
    undefined,
    () => {
      if (token !== textureToken) return
      // 图加载失败（会话级 objectURL 刷新后失效等）：回到占位态而非破图
      hasTexture.value = false
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
    const rnd = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    rnd.setSize(w, h, false)
    rnd.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    rnd.domElement.style.cssText =
      'display:block;width:100%;height:100%;position:absolute;inset:0;cursor:grab'
    el.appendChild(rnd.domElement)

    const scn = new THREE.Scene()
    scn.background = new THREE.Color('#f3f4f6')
    const cam = new THREE.PerspectiveCamera(current.fov, w / h, 0.1, 1100)
    cam.position.set(0, 0, 0)

    // 球翻面（scale(-1,1,1)）→ 我们从球心看到的是内壁，正好当全景幕布
    const geo = new THREE.SphereGeometry(1000, 64, 32)
    geo.scale(-1, 1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: '#e5e7eb' })
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

/** 手填图片地址后写回节点（经插件服务走图写入口，自动进历史/落盘） */
function applyUrl(): void {
  const url = draftUrl.value.trim()
  if (!url) return
  draftUrl.value = ''
  ctx.get<{ setImageUrl(id: string, url: string): void }>('panorama3d').setImageUrl(props.id, url)
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

// 上游/自身图片变化 → 换贴图（挂载前就记录地址，挂载时一次初始化）
watch(ownImageUrl, (url) => {
  textureUrl.value = url
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

    <!-- 没贴图时的占位说明：可手填图片地址，或直接把图片节点连进来 -->
    <div v-if="!hasTexture" class="pano-empty">
      <svg class="pano-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <ellipse cx="12" cy="12" rx="6" ry="2" />
        <path d="M6 12c0 3.3 2.7 6 6 6s6-2.7 6-6" />
        <path d="M6 12c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
      <span class="pano-empty-text">{{ renderError || '把图片节点连进来，或填图片地址' }}</span>
      <form v-if="!renderError" class="pano-url nodrag nopan" @submit.prevent="applyUrl">
        <input
          v-model="draftUrl"
          class="pano-url-input"
          type="text"
          inputmode="url"
          placeholder="粘贴全景图地址"
          aria-label="全景图地址"
          @pointerdown.stop
        />
        <button class="pano-url-go" type="submit" title="应用地址" aria-label="应用地址" :disabled="!draftUrl.trim()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
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
  background: #f3f4f6;
}
.pano-surface {
  position: absolute;
  inset: 0;
  touch-action: none;
}

/* 空态 */
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
.pano-empty-icon {
  width: 36px;
  height: 36px;
  color: #d1d5db;
}
.pano-empty-text {
  color: #9ca3af;
  /* 中文正文最低 12px */
  font-size: 12px;
  line-height: 1.5;
}

/* 空态里的地址输入：凹陷浅底 + 10px 圆角，输入框可点（不拖节点） */
.pano-url {
  display: flex;
  align-items: center;
  gap: 4px;
  width: min(260px, 100%);
  padding: 6px 6px 6px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  pointer-events: auto;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pano-url:focus-within {
  background: rgba(0, 0, 0, 0.06);
}
.pano-url-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  color: #111827;
  font: inherit;
  font-size: 13px;
}
.pano-url-input::placeholder {
  color: #9ca3af;
}
.pano-url-go {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(8, 145, 178, 0.12);
  color: #0e7490;
  cursor: pointer;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.pano-url-go:hover:not(:disabled) {
  background: rgba(8, 145, 178, 0.2);
}
.pano-url-go:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pano-url-go:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.pano-url-go svg {
  width: 14px;
  height: 14px;
}

/* 全屏层（f 切换）：铺满视口、纯黑无装饰。
   里面不放任何提示/按钮 —— 用户明确要求删掉常驻文案（"会遮挡视线"），
   全屏时唯一的操作入口是键盘（f 切回、r 重置、Esc 退出）。 */
.pano-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: #000;
  touch-action: none;
}

@media (prefers-reduced-motion: reduce) {
  .pano-url,
  .pano-url-go {
    transition: none;
  }
}
</style>
