<script setup lang="ts">
import type { NodeProps } from "@vue-flow/core"
import { useVueFlow } from "@vue-flow/core"
import { ref, onMounted, onUnmounted, watch, nextTick, computed, inject } from "vue"
import { NodeIdInjection } from "@vue-flow/core"
import type { Edge, Node } from "@vue-flow/core"
import * as THREE from "three"

defineOptions({ inheritAttrs: false })
const props = defineProps<NodeProps>()
const nodeId = inject(NodeIdInjection, null) as string | null

const { getEdges, findNode } = useVueFlow()

const containerRef = ref<HTMLDivElement | null>(null)
const fullscreenContainerRef = ref<HTMLDivElement | null>(null)
const fullscreen = ref(false)

const editing = computed(() => !!(props.data as any)?._editing)
const hasImage = ref(false)

/** 从上游连接的 image 节点获取 imageUrl（优先级高于自身 data） */
const connectedImageUrl = computed(() => {
  if (!nodeId) return ""
  const edges = getEdges.value as Edge[]
  const connectedEdge = edges.find(
    (e) => e.target === nodeId && e.targetHandle === "target"
  )
  if (!connectedEdge) return ""
  const sourceNode = (findNode(connectedEdge.source) as Node | undefined)
  return (sourceNode?.data as any)?.imageUrl as string || ""
})

/** 自身 data 上的 imageUrl（兜底） */
const ownImageUrl = computed(() =>
  (props.data?.imageUrl as string) || (props.data?.panoUrl as string) || ""
)

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let sphere: THREE.Mesh | null = null
let material: THREE.MeshBasicMaterial | null = null
let textureLoader = new THREE.TextureLoader()
let animFrameId = 0
let resizeObserver: ResizeObserver | null = null
let initialized = false

let lon = 0, lat = 0
let targetLon = 0, targetLat = 0
let isDragging = false
let dragStartX = 0, dragStartY = 0
let dragStartLon = 0, dragStartLat = 0

function getImageUrl(): string {
  return connectedImageUrl.value || ownImageUrl.value
}

function getContainerSize(el?: HTMLElement | null) {
  const target = el || containerRef.value
  if (!target) return { w: 640, h: 400 }
  const rect = target.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height }
  return { w: 640, h: 400 }
}

function initThree() {
  if (!containerRef.value || initialized) return
  const { w, h } = getContainerSize()
  if (w === 0 || h === 0) { setupResizeObserver(); return }

  scene = new THREE.Scene()
  scene.background = new THREE.Color("#f3f4f6")
  camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1100)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;position:absolute;inset:0"
  containerRef.value.appendChild(renderer.domElement)

  const geometry = new THREE.SphereGeometry(1000, 64, 32)
  geometry.scale(-1, 1, 1)

  const imgUrl = getImageUrl()
  if (imgUrl) {
    const texture = textureLoader.load(imgUrl, () => { hasImage.value = true })
    material = new THREE.MeshBasicMaterial({ map: texture })
  } else {
    material = new THREE.MeshBasicMaterial({ color: "#e5e7eb" })
  }
  sphere = new THREE.Mesh(geometry, material)
  scene.add(sphere)
  camera.position.set(0, 0, 0)

  initialized = true
  bindEvents()
  animate()
  setupResizeObserver()
}

function setupResizeObserver() {
  if (resizeObserver || !containerRef.value) return
  if (typeof ResizeObserver === "undefined") return
  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !containerRef.value) return
    const { w: nw, h: nh } = getContainerSize()
    if (nw === 0 || nh === 0) return
    renderer.setSize(nw, nh, false)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(containerRef.value)
}

function animate() {
  animFrameId = requestAnimationFrame(animate)
  if (!camera || !renderer || !scene) return
  lon += (targetLon - lon) * 0.1
  lat += (targetLat - lat) * 0.1
  targetLat = Math.max(-85, Math.min(85, targetLat))
  const phi = THREE.MathUtils.degToRad(90 - lat)
  const theta = THREE.MathUtils.degToRad(lon)
  const target = new THREE.Vector3()
  target.setFromSphericalCoords(1000, phi, theta)
  camera.lookAt(target)
  renderer.render(scene, camera)
}

function bindEvents() {
  const el = renderer?.domElement
  if (!el) return

  const onPointerDown = (e: PointerEvent) => {
    if (!editing.value) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    isDragging = true
    dragStartX = e.clientX; dragStartY = e.clientY
    dragStartLon = targetLon; dragStartLat = targetLat
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging || !editing.value) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    targetLon = (e.clientX - dragStartX) * 0.12 + dragStartLon
    targetLat = (e.clientY - dragStartY) * 0.12 + dragStartLat
  }
  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    isDragging = false
  }
  const onWheel = (e: WheelEvent) => {
    if (!editing.value) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    if (!camera) return
    camera.fov += e.deltaY * 0.05
    camera.fov = THREE.MathUtils.clamp(camera.fov, 25, 90)
    camera.updateProjectionMatrix()
  }

  el.addEventListener("pointerdown", onPointerDown, true)
  el.addEventListener("pointermove", onPointerMove, true)
  window.addEventListener("pointerup", onPointerUp, true)
  el.addEventListener("wheel", onWheel, { passive: false, capture: true })

  ;(el as any).__panoramaCleanup = () => {
    el.removeEventListener("pointerdown", onPointerDown, true)
    el.removeEventListener("pointermove", onPointerMove, true)
    window.removeEventListener("pointerup", onPointerUp, true)
    el.removeEventListener("wheel", onWheel, true)
  }
}

function updateTexture(url: string) {
  if (!material) return
  textureLoader.load(url, (tex) => {
    material!.map = tex
    material!.needsUpdate = true
    hasImage.value = true
  })
}

function destroyThree() {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  const el = renderer?.domElement
  if (el && (el as any).__panoramaCleanup) { (el as any).__panoramaCleanup() }
  if (renderer) { renderer.dispose(); renderer.domElement.remove() }
  sphere?.geometry?.dispose()
  material?.dispose()
  scene = null; camera = null; renderer = null; sphere = null; material = null
  initialized = false
}

function toggleFullscreen() {
  if (!fullscreen.value) {
    fullscreen.value = true
    nextTick(() => {
      if (fullscreenContainerRef.value && renderer) {
        fullscreenContainerRef.value.appendChild(renderer.domElement)
        const { w, h } = getContainerSize(fullscreenContainerRef.value)
        if (w > 0 && h > 0 && camera) {
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
      }
    })
  } else {
    fullscreen.value = false
    nextTick(() => {
      if (containerRef.value && renderer) {
        containerRef.value.appendChild(renderer.domElement)
        const { w, h } = getContainerSize(containerRef.value)
        if (w > 0 && h > 0 && camera) {
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
      }
    })
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && fullscreen.value) {
    toggleFullscreen()
  }
}

// 监听 toolbar 全屏命令
function onFullscreenCmd(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId !== nodeId) return
  toggleFullscreen()
}

onMounted(async () => {
  await nextTick()
  hasImage.value = !!getImageUrl()
  initThree()
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("panorama:fullscreen", onFullscreenCmd)
})

onUnmounted(() => {
  destroyThree()
  window.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("panorama:fullscreen", onFullscreenCmd)
})

/** 统一监听：上游连接变化 或 自身 data 变化时更新纹理 */
watch(
  () => connectedImageUrl.value || ownImageUrl.value,
  (newUrl, oldUrl) => {
    const url = (newUrl as string) || ""
    if (url) {
      if (!initialized) initThree()
      updateTexture(url)
    } else if (oldUrl) {
      destroyThree()
      nextTick(() => { hasImage.value = false; initThree() })
    }
  }
)
</script>

<template>
  <div class="absolute inset-0 overflow-hidden bg-gray-100">
    <div
      ref="containerRef"
      class="absolute inset-0"
      :style="{ cursor: editing ? 'grab' : 'default', touchAction: editing ? 'none' : 'auto' }"
    />

    <div v-if="!hasImage" class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="flex flex-col items-center gap-2">
        <svg class="w-10 h-10 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <ellipse cx="12" cy="12" rx="6" ry="2" />
          <path d="M6 12c0 3.3 2.7 6 6 6s6-2.7 6-6" />
          <path d="M6 12c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        </svg>
        <span class="text-xs text-gray-400">360° 全景</span>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="fullscreen" ref="fullscreenContainerRef" class="fixed inset-0 z-[99999] bg-black">
      <button
        class="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
        title="退出全屏 (Esc)"
        @click="toggleFullscreen"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 14 10 14 10 20" />
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs">
        拖拽旋转 · 滚轮缩放 · Esc 退出全屏
      </div>
    </div>
  </Teleport>
</template>
