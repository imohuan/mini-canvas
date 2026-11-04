import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { setUiCatalogHost, uiComponentStatic } from '@mini-canvas/canvas-render'
import { createOutsideComponentTracker } from '../uiCatalogOutside'
import type { HostApi } from './types'

const hostRef = shallowRef<HostApi | undefined>()
export const readyHost: { readonly ctx?: HostApi['ctx'] } = {
  get ctx() {
    return hostRef.value?.ctx
  },
}

/**
 * 按名取 ui 目录里登记的组件（画布树外也能用 —— 走宿主 ready ctx）。
 * 树外区域（生成历史弹窗等）没有 useCanvasRender 的 provide，取不到渲染上下文；
 * 宿主 ctx 就绪后从 registryOf('ui') 读一份即可。没就绪/没登记 → undefined。
 */
export function uiComponentOf(name: string): unknown {
  return readyHost?.ctx?.registryOf?.<unknown>('ui')?.top(name)?.value ?? uiComponentStatic(name)
}

/**
 * 宿主组件取件的响应式版本：目录里的赢家变了（换主题 / 插件热装）就自动换。
 *
 * 树外区域（资产预览、生成历史、设置面板、调试覆盖层）没有 `useCanvasRender` 的 provide，
 * 只能走宿主 ctx；但读取点同样发生在渲染里，所以目录值必须是 ref。
 * 用 shallowRef 存组件句柄：深代理会让 Vue 警告并拖慢渲染。
 */
export function useUiComponentOutside(name: string): Ref<unknown> {
  const tracker = createOutsideComponentTracker(
    name,
    () => readyHost.ctx?.registryOf?.<unknown>('ui'),
    () => uiComponentStatic(name),
  )
  /**
   * 订阅 ui 目录本身，而不是只监听“插件安装”这一个时刻。
   *
   * 目录的赢家可能因为：装/卸插件、同 id 热替换、主题包重载、order 变化而改变；
   * 只挂 plugin-installed 会漏掉热替换（组件还在，但换成了另一份实现）。
   * `registryOf('ui').subscribe()` 是注册场给出的标准变化通知，覆盖全部路径。
   *
   * 为什么不用 watchEffect 反复读 `uiComponentOf`：那只能感知宿主 ctx 赋值，
   * 目录表内部的替换不会触发任何 ref。
   */
  onMounted(tracker.bind)
  // hostRef 是模块级 shallowRef：宿主晚到、重连、销毁都会在这里收到。
  watch(hostRef, tracker.bind)
  onBeforeUnmount(tracker.dispose)
  return tracker.current
}
export function setReadyHost(h: unknown): void {
  hostRef.value = h as HostApi | undefined
  // 同步给 canvas-render 的“树外取件”入口：MediaViewer（plugin-theme-components）在画布树外
  // （资产抽屉 / 生成历史弹窗）也要能按名取注册件 —— 主题包不能反向依赖 ui 包，
  // 所以由宿主侧在就绪时注入，见 canvas-render/contracts/uiCatalog.ts。
  void setUiCatalogHost(readyHost?.ctx as never)
}

