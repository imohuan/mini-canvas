/**
 * pendingSave —— 「离开画布前先把脏改动写完」的全局钩子。
 *
 * 为什么需要它：画布保存是**异步**的（save.flush 里会发网络请求）。切画布 / 回项目页时，
 * 旧画布的 CanvasHost 会卸载，而卸载时那次 flush 是「发出去就不管了」——导航紧接着发生，
 * 这次保存就丢了（用户实测：切了画布回来发现改动没了）。
 *
 * 解法：路由守卫在**导航确认之前**（旧组件还挂着、适配器还在）await 一次落盘。
 * 这里做成一个可注册的钩子，避免 router 直接 import ui（会牵出组件依赖环）。
 */
let flushFn: (() => Promise<void>) | undefined

/** 注册「落盘」实现（ui.ts 在宿主就绪时注册；卸载时注销） */
export function registerPendingSave(fn: () => Promise<void>): void {
  flushFn = fn
}

export function unregisterPendingSave(fn: () => Promise<void>): void {
  if (flushFn === fn) flushFn = undefined
}

/** 把当前脏改动写完（没注册/没脏数据时是廉价 no-op） */
export async function flushPendingSave(): Promise<void> {
  try {
    await flushFn?.()
  } catch {
    /* 保存失败不该挡住导航（下一次进画布仍会读到服务器那份） */
  }
}
