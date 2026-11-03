import { ref, type Ref } from 'vue'
import type { SettingsStore } from '@mini-canvas/kernel'
import type { FullHost, HostApi, HostLike, HostRef } from './types'
import { readyHost } from './hostRuntime'

/**
 * 宿主句柄 + 各种按名取服务的小入口。
 *
 * 原样从 ui.ts 拆出：hostEl 的写入方式、hostCtx 的回落顺序（hostEl.host ?? hostEl，
 * 再退 window.MiniCanvasUI）都不改，避免设置/命令/建节点走到不同宿主。
 */
export function createUiHostScope() {
  // ===== 宿主 =====
  const hostEl = ref<HostLike | null>(null)
  /**
   * 模板 ref 的写入口：App.vue 的函数 ref 调它把 CanvasHost 组件实例写进 hostEl 内部。
   * 为什么不直接 `ui.hostEl = el`：hostEl 经单例 reactive 解包后，setupState 里读到的是
   * HostLike 本身（不是 ref），赋值只会覆盖属性、写不进 ref.value —— 绑定会静默失效。
   */
  function setHostEl(el: unknown): void {
    hostEl.value = el as HostLike | null
  }

  // 原则：状态栏按钮**不自己保存一份状态、不直接碰画布**，只做两件事之一 ——
  //   ① 写内核设置（ctx.get('settings').set）：连线显隐 / 网格吸附 / 画布模式
  //      → 真正干活的是订阅这些 key 的消费方（渲染宿主 / 主题皮），与设置面板**同一条通道**；
  //   ② 执行命令（canvas.runCommand）：整理画布 / 聚焦
  //      → 走插件已注册的命令，复用撤销栈与落盘，不另抄一份实现。
  //
  // 为什么用 settings 而不是各插件的服务：edgeVisible / snapToGrid 是"宿主级"键
  // （theme-default / canvas-render 声明并订阅），设置面板已经在用它们；按钮也写同一处，
  // 面板与按钮天然同步、不出现"按钮关了面板还开着"这种双源漂移。
  /** 当前宿主句柄里的 ctx（拿不到 = 画布还没就绪，所有开关静默不动） */
  function hostCtx(): HostApi['ctx'] | undefined {
    return ((hostEl.value?.host ?? hostEl.value) as FullHost | undefined)?.ctx
  }
  /** 读设置现值（未声明 / 服务缺失 → undefined，调用方自行回落） */
  function readSetting<T extends string | number | boolean>(key: string): T | undefined {
    return hostCtx()?.get<SettingsStore>('settings')?.get(key) as T | undefined
  }
  /** 写设置现值（未声明时 set 会抛，这里吞掉 —— 按钮不该因某个插件没装就报错） */
  function writeSetting(key: string, value: string | number | boolean): void {
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store?.has?.(key)) return
    store.set(key, value)
  }
  /** 执行一条已注册命令（未注册 → no-op，不报错） */
  function runCommand(id: string): void {
    hostCtx()?.get<{ runCommand(id: string): unknown }>('canvas')?.runCommand(id)
  }

  /** 取画布宿主（hostEl 优先；没有就退到 window 上暴露的那份） */
  function canvasHost(): FullHost | undefined {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    return host ?? (window as unknown as { MiniCanvasUI?: { getHost(): FullHost } }).MiniCanvasUI?.getHost()
  }

  /** 取内核 ctx（画布服务都挂在它下面）；宿主未就绪或没装插件 → undefined */
  function canvasCtx(): { get<T>(name: string): T | undefined } | undefined {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    return host?.ctx as { get<T>(name: string): T | undefined } | undefined
  }

  /**
   * 外壳自己的轻提示：走默认主题的全局 notify 服务（vue-sonner）。
   *
   * 插件与画布页面一律使用同一个服务；这里保留 showToast 的名字，是为了让外壳里
   * 几十个既有调用点不用同时改。要换通知样式/位置，只改 Toaster 那一处。
   */
  function showToast(message: string): void {
    const notify = readyHost.ctx?.tryGet?.<{ success?: (m: string) => void }>('notify')
    if (notify?.success) notify.success(message)
    else console.info('[notify]', message)
  }

  return { hostEl, setHostEl, hostCtx, readSetting, writeSetting, runCommand, canvasHost, canvasCtx, showToast }
}

export type UiHostScope = ReturnType<typeof createUiHostScope>

