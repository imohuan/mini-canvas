/**
 * 3D 场景本身：three 初始化、渲染循环、统一资源释放。
 *
 * 原 PanoramaContent.vue 里的 initThree / tick / disposeThree 原样搬到这里。
 * 初始化顺序、渲染循环启停和卸载时的资源释放顺序都保持不变：
 * renderer → scene → camera → geometry → material → loader → 绑事件 → 观察尺寸 → 贴图 → 启动循环；
 * 卸载时先停循环、跑清理函数、断开尺寸观察，再按 renderer → geometry → material → texture 释放。
 */
import * as THREE from 'three'
import type { Ref } from 'vue'
import { damp, toSpherical } from '../panoramaView'
import { createPanoramaThreeState, type PanoramaThreeState } from './threeState'

export interface PanoramaSceneOptions {
  /** 节点内容器（three 的 canvas 默认挂这里） */
  hostRef: Ref<HTMLDivElement | null>
  /** 容器当前像素尺寸 */
  containerSize: () => { w: number; h: number }
  /** 绑定交互事件；返回值是注册到统一清理列表的注销函数 */
  bindEvents: (el: HTMLElement) => () => void
  /** 监听容器尺寸变化 */
  observeSize: (el: HTMLElement) => void
  /** 断开尺寸观察 */
  disconnectSize: () => void
  /** 按当前贴图地址更新材质 */
  updateTexture: (url: string) => void
  /** 当前贴图地址 */
  textureUrl: Ref<string>
  /** 渲染失败提示（WebGL 不可用等） */
  renderError: Ref<string>
  /** 主题变量读取（无 DOM 时回落兜底色） */
  themeColor: (varName: string, fallback: string) => string
  /** 无 DOM 时的兜底色 */
  fallback: { surface: string; border: string }
}

/** three 对象、视角状态和循环句柄：入口持有同一份引用，卸载时从这一份统一释放 */
export interface PanoramaSceneApi extends PanoramaThreeState {
  initThree: () => void
  tick: () => void
  disposeThree: () => void
}

export function createPanoramaScene(options: PanoramaSceneOptions): PanoramaSceneApi {
  const state = createPanoramaThreeState()
  const { renderer, scene, camera, material, geometry, loadedTexture, loader, view } = state

  let frameId = 0
  /** 已注册的清理函数（卸载时统一跑） */
  const cleanupFns: Array<() => void> = []

  /** 每帧：把视角朝目标推近一点，再让相机看向对应方向并渲染一帧 */
  function tick(): void {
    frameId = requestAnimationFrame(tick)
    const cam = camera.value
    const rnd = renderer.value
    const scn = scene.value
    if (!cam || !rnd || !scn) return

    view.current = {
      lon: damp(view.current.lon, view.target.lon, 0.1),
      lat: damp(view.current.lat, view.target.lat, 0.1),
      fov: damp(view.current.fov, view.target.fov, 0.1),
    }
    const { phi, theta } = toSpherical(view.current.lon, view.current.lat)
    const lookAt = new THREE.Vector3().setFromSphericalCoords(1000, phi, theta)
    cam.lookAt(lookAt)
    if (Math.abs(cam.fov - view.current.fov) > 0.01) {
      cam.fov = view.current.fov
      cam.updateProjectionMatrix()
    }
    rnd.render(scn, cam)
  }

  /** 建 three 场景：反着贴图的大球（相机在球心往外看）+ 透视相机 */
  function initThree(): void {
    const el = options.hostRef.value
    if (!el || renderer.value) return
    const { w, h } = options.containerSize()

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
      const cam = new THREE.PerspectiveCamera(view.current.fov, w / h, 0.1, 1100)
      cam.position.set(0, 0, 0)

      // 球翻面（scale(-1,1,1)）→ 我们从球心看到的是内壁，正好当全景幕布
      const geo = new THREE.SphereGeometry(1000, 64, 32)
      geo.scale(-1, 1, 1)
      const mat = new THREE.MeshBasicMaterial({ color: options.themeColor('--canvas-node-border', options.fallback.border) })
      scn.add(new THREE.Mesh(geo, mat))

      renderer.value = rnd
      scene.value = scn
      camera.value = cam
      geometry.value = geo
      material.value = mat
      loader.value = new THREE.TextureLoader()

      cleanupFns.push(options.bindEvents(rnd.domElement))
      options.observeSize(el)
      options.updateTexture(options.textureUrl.value)
      tick()
    } catch (err) {
      options.renderError.value = err instanceof Error ? err.message : '3D 渲染不可用'
    }
  }

  /** 统一卸载：循环、事件、尺寸观察、renderer / geometry / material / texture 全部走这一条路径 */
  function disposeThree(): void {
    if (frameId) cancelAnimationFrame(frameId)
    frameId = 0
    for (const fn of cleanupFns.splice(0)) fn()
    options.disconnectSize()
    renderer.value?.dispose()
    renderer.value?.domElement.remove()
    /**
     * 显式丢 WebGL 上下文：只 dispose() 不丢上下文时，浏览器要等 GC 才真正释放 ——
     * 画布上几十个 3D 节点来回切（或反复进全屏）很容易撞上浏览器「同时存在的
     * WebGL 上下文上限」，之后的画布会整块变黑。forceContextLoss 是 three 官方推荐配对调用。
     */
    renderer.value?.forceContextLoss?.()
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

  return {
    ...state,
    initThree,
    tick,
    disposeThree,
  }
}
