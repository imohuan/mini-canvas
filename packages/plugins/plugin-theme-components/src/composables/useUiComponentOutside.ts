/**
 * 设置面板在**画布树外**按名取 ui 组件（设置面板挂在外壳槽里，没有 useCanvasRender 的 provide）。
 *
 * 取件路径与 packages/ui 的同名工具一致：
 *   宿主目录（ctx.registryOf('ui')，主题插件登记的那一份）
 *   → 主题在 Provider 外发布的静态目录（setStaticUiCatalog，见本包 index.ts）
 *   → 调用方给的 fallback。
 *
 * 为什么需要：设置字段控件（settingsField）由组件库登记，面板自己不 import 组件库；
 * 目录还没就绪时用本包自带的 SettingsSchemaField 兜底，目录就绪后换成赢家。
 */
import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { uiComponentStatic } from '@plume-canvas/canvas-render'

/** 宿主的 ui 目录句柄（宿主就绪时注入；宿主换新会重读并重订阅） */
interface UiCatalogLike {
  top(name: string): { value: unknown } | undefined
  subscribe?(fn: () => void): { dispose(): void }
}

const hostCatalog = shallowRef<UiCatalogLike | undefined>()

/**
 * 把宿主 ctx 的 ui 目录接上来（宿主就绪 / 重连时调用；传 undefined 表示宿主被撤掉）。
 * 设置面板的字段控件靠它换赢家，所以宿主 ready 时调一次即可（幂等）。
 */
export function setSettingsUiCatalog(ctx: { registryOf?: (kind: string) => unknown } | undefined): void {
  const field = ctx?.registryOf?.('ui') as UiCatalogLike | undefined
  hostCatalog.value = field && typeof field.top === 'function' ? field : undefined
}

/** 响应式取件：目录赢家变了就跟着换（返回的 ref 在模板里自动解包）。 */
export function useUiComponentOutside(name: string): Ref<unknown> {
  const current = shallowRef<unknown>(undefined)
  let sub: { dispose(): void } | undefined

  function sync(): void {
    const next = hostCatalog.value?.top(name)?.value ?? uiComponentStatic(name)
    if (next !== current.value) current.value = next
  }
  function bind(): void {
    sub?.dispose()
    sub = undefined
    const field = hostCatalog.value
    if (field && typeof field.subscribe === 'function') sub = field.subscribe(sync)
    sync()
  }

  // 首次就同步读一次：模板首帧就要用到组件
  sync()
  onMounted(bind)
  watch(hostCatalog, bind)
  onBeforeUnmount(() => {
    sub?.dispose()
    sub = undefined
  })
  return current
}
