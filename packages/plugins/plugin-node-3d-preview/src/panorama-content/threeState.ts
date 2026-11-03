/**
 * three 对象与视角状态的持有处。
 *
 * three 对象放 shallowRef：它们是重量级外部对象，不需要（也不该）被 Vue 深度代理。
 * 入口、场景初始化、贴图更新与卸载共享这一份引用，避免各模块各存一份导致漏释放。
 */
import * as THREE from 'three'
import { shallowRef, type ShallowRef } from 'vue'
import { DEFAULT_VIEW, type ViewState } from '../panoramaView'

/** 本包 three shim（env.d.ts）只声明运行时符号，类型从构造函数推导 */
export type WebGLRenderer = InstanceType<typeof THREE.WebGLRenderer>
export type Scene = InstanceType<typeof THREE.Scene>
export type PerspectiveCamera = InstanceType<typeof THREE.PerspectiveCamera>
export type MeshBasicMaterial = InstanceType<typeof THREE.MeshBasicMaterial>
export type SphereGeometry = InstanceType<typeof THREE.SphereGeometry>
export type Texture = InstanceType<typeof THREE.Texture>
export type TextureLoader = InstanceType<typeof THREE.TextureLoader>

export interface PanoramaThreeState {
  renderer: ShallowRef<WebGLRenderer | null>
  scene: ShallowRef<Scene | null>
  camera: ShallowRef<PerspectiveCamera | null>
  material: ShallowRef<MeshBasicMaterial | null>
  geometry: ShallowRef<SphereGeometry | null>
  loadedTexture: ShallowRef<Texture | null>
  loader: ShallowRef<TextureLoader | null>
  /** 视角：target 是"想去的地方"，current 是"现在在哪" */
  view: { target: ViewState; current: ViewState }
}

export function createPanoramaThreeState(): PanoramaThreeState {
  return {
    renderer: shallowRef<WebGLRenderer | null>(null),
    scene: shallowRef<Scene | null>(null),
    camera: shallowRef<PerspectiveCamera | null>(null),
    material: shallowRef<MeshBasicMaterial | null>(null),
    geometry: shallowRef<SphereGeometry | null>(null),
    loadedTexture: shallowRef<Texture | null>(null),
    loader: shallowRef<TextureLoader | null>(null),
    view: {
      target: { ...DEFAULT_VIEW },
      current: { ...DEFAULT_VIEW },
    },
  }
}
