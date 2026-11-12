/**
 * three 的 shim：0.184 的 npm 包不带 .d.ts（类型只在 @types/three 里）。
 *
 * 宿主（本包）通过 plugin-node-3d-preview 的源码间接用到 three；那个包自己的 env.d.ts
 * 也有声明，但它的 typecheck 是 tsc（不解析 .vue），本包是 vue-tsc（会解析），
 * 所以这份 shim 必须存在，否则 ui typecheck 在 PanoramaContent.vue 里报 TS7016/TS2503。
 *
 * 只声明**用得上的**符号，并且值/类型都给（`import * as THREE from 'three'` 之后，
 * 代码既写 `THREE.WebGLRenderer` 当类型、也 `new THREE.WebGLRenderer()` 当值）。
 * 全部落到 any：本包不关心 three 的 API 形状，那由插件自己的测试与真机验证兜住。
 */
declare module 'three' {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  export const WebGLRenderer: any
  export type WebGLRenderer = any
  export const Scene: any
  export type Scene = any
  export const PerspectiveCamera: any
  export type PerspectiveCamera = any
  export const MeshBasicMaterial: any
  export type MeshBasicMaterial = any
  export const SphereGeometry: any
  export type SphereGeometry = any
  export const Mesh: any
  export type Mesh = any
  export const Texture: any
  export type Texture = any
  export const TextureLoader: any
  export type TextureLoader = any
  export const Vector3: any
  export type Vector3 = any
  export const SRGBColorSpace: any
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
