// browserFlush —— 浏览器生命周期落盘绑定（M4）：visibilitychange(hidden) + pagehide → flush。
// 放 demo-web(浏览器层)：内核 SaveService 本身无 DOM 依赖，此文件只在浏览器入口 import。
import type { SaveService } from '../src/services/storage/types'

export interface BrowserFlushHandle {
  flush(): Promise<void>
  dispose(): void
}

/**
 * 把 SaveService 挂到页面生命周期：页面隐藏/离开时把脏队列落盘（防刷新/关标签丢数据）。
 * @param save ctx.get('save')
 * @param win 窗口对象（默认 globalThis，测试可注入假 window）
 */
export function bindBrowserLifecycleFlush(save: SaveService, win: Window = window): BrowserFlushHandle {
  const flush = (): void => {
    if (save.isDirty()) void save.flush()
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }
  win.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', flush)
  return {
    flush,
    dispose: () => {
      win.removeEventListener('visibilitychange', onVisibility)
      win.removeEventListener('pagehide', flush)
    },
  }
}
