/**
 * 登录面板（cloud-client 负责）：shadcn 组件 + 原生 Vue 运行时。
 *
 * 为什么从全局取 Vue / PlumeUiKit：本插件产物是「零 import 自包含 ESM」，
 * 直接 import vue 会让 data: 模块解析失败，也会造出第二份 Vue。
 * 宿主在挂载前已把同一份 Vue 与 shadcn 组件挂到 window（见 packages/ui/src/sharedGlobals.ts），
 * 这里只读它们，组件外观仍是组件库那一套（换主题跟着换）。
 *
 * 界面文案不出现「令牌」：对用户只说「登录 / 密码」（用户口径 2026-11-12）。
 */
import type { Component, VNode } from 'vue'
import type { CloudAuth, AuthStatus } from './auth.js'
import { validateTokenInput } from './auth.js'

interface VueRuntime {
  createApp(component: Component): { mount(el: Element): void; unmount(): void }
  h(type: unknown, props?: Record<string, unknown> | null, children?: unknown): VNode
  reactive<T extends object>(value: T): T
  ref<T>(value: T): { value: T }
}

interface UiKit {
  Button: Component
  Card: Component
  CardHeader: Component
  CardTitle: Component
  CardDescription: Component
  CardContent: Component
  CardFooter: Component
  Input: Component
  Label: Component
}

function vueRuntime(): VueRuntime | undefined {
  return (globalThis as unknown as { Vue?: VueRuntime }).Vue
}

function uiKit(): UiKit | undefined {
  return (globalThis as unknown as { PlumeUiKit?: UiKit }).PlumeUiKit
}

export interface AuthGateHandle {
  open(status: AuthStatus): void
  close(): void
  destroy(): void
  readonly element: HTMLElement | null
}

interface GateState {
  open: boolean
  configured: boolean
  password: string
  confirm: string
  error: string
  busy: boolean
}

export function createAuthGate(auth: CloudAuth): AuthGateHandle {
  if (typeof document === 'undefined') {
    return { open: () => {}, close: () => {}, destroy: () => {}, element: null }
  }
  const Vue = vueRuntime()
  const ui = uiKit()
  if (!Vue || !ui) {
    // 宿主没准备好共享全局（极少数自建宿主）：不锁死界面，交给页面自己的 403 提示
    return { open: () => {}, close: () => {}, destroy: () => {}, element: null }
  }

  const host = document.createElement('div')
  host.setAttribute('data-plume-auth-gate', '')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:var(--ui-canvas-bg,#f5f6f8)'
  document.body.append(host)

  const state = Vue.reactive<GateState>({
    open: false,
    configured: false,
    password: '',
    confirm: '',
    error: '',
    busy: false,
  })

  async function submit(): Promise<void> {
    if (state.busy) return
    /** 以真实输入框为准：不依赖组件 v-model 的回写时序 */
    const pw = host.querySelector<HTMLInputElement>('#plume-auth-password')
    const cf = host.querySelector<HTMLInputElement>('#plume-auth-confirm')
    if (pw) state.password = pw.value
    if (cf) state.confirm = cf.value
    const why = validateTokenInput(state.password)
    if (why) {
      state.error = why
      return
    }
    if (!state.configured && state.password !== state.confirm) {
      state.error = '两次输入的密码不一样'
      return
    }
    state.busy = true
    state.error = ''
    const message = state.configured ? await auth.login(state.password) : await auth.setup(state.password)
    state.busy = false
    if (message) {
      state.error = message
      return
    }
    state.password = ''
    state.confirm = ''
    /*
     * 登录成功后**两层都要收**：只把 state.open 设成 false 只会移除卡片，
     * 承载它的全屏 host 仍然是 display:flex —— 暗色主题下就是一块纯黑遮罩，
     * 看起来像“登录完黑屏”（2026-11-12 用户截图）。
     */
    state.open = false
    host.style.display = 'none'
  }

  const field = (label: string, key: 'password' | 'confirm', autofocus = false): VNode =>
    Vue.h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
      Vue.h(ui.Label, { for: 'plume-auth-' + key }, () => label),
      Vue.h(ui.Input, {
        id: 'plume-auth-' + key,
        type: 'password',
        autocomplete: key === 'password' ? 'current-password' : 'new-password',
        autofocus,
        modelValue: state[key],
      }),
    ])

  const Gate = {
    name: 'PlumeAuthGate',
    setup() {
      return () => {
        if (!state.open) return null
        const title = state.configured ? '登录' : '创建登录密码'
        const desc = state.configured
          ? '请输入你设置过的密码。'
          : '第一次使用，请设置一个至少 5 位的密码。之后打开会自动登录。'
        /*
         * 外面这层用 `<form>`：密码框放进表单，浏览器才不会报
         * “Password field is not contained in a form”（2026-11-12 控制台截图）。
         * 提交流程仍由宿主上的 click / 回车监听统一处理，不依赖表单的默认提交。
         */
        return Vue.h('form', {
          style: 'padding:24px;width:min(380px,100%)',
          onSubmit: (e: Event) => {
            e.preventDefault()
            void submit()
          },
        }, [
          Vue.h(ui.Card, null, () => [
            Vue.h(ui.CardHeader, null, () => [
              Vue.h(ui.CardTitle, null, () => title),
              Vue.h(ui.CardDescription, null, () => desc),
            ]),
            Vue.h(ui.CardContent, { style: 'display:flex;flex-direction:column;gap:12px' }, () => [
              field('密码', 'password', true),
              ...(state.configured ? [] : [field('确认密码', 'confirm')]),
              state.error
                /* 文本直接传字符串：传函数会被 Vue 当成 slot，普通元素会渲染成空节点 */
                ? Vue.h('p', { role: 'alert', style: 'margin:0;font-size:12px;color:var(--ui-danger,#ef4444)' }, state.error)
                : null,
            ]),
            Vue.h(ui.CardFooter, { style: 'justify-content:flex-end' }, () => [
              Vue.h(ui.Button, { type: 'button', 'data-auth-submit': '', disabled: state.busy }, () =>
                state.busy ? '请稍候…' : state.configured ? '登录' : '设置并进入',
              ),
            ]),
          ]),
        ])
      }
    },
  }

  const app = Vue.createApp(Gate)
  app.mount(host)

  /**
   * 统一在宿主上监听：组件库的 Button / Input 经 UMD 全局复用，
   * 事件 prop 不一定透传；这里按真实 DOM 处理，行为稳定。
   */
  function onClick(event: Event): void {
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-auth-submit]') || target?.closest('button')) void submit()
  }
  function onInput(event: Event): void {
    const el = event.target as HTMLInputElement | null
    if (!el || el.tagName !== 'INPUT') return
    if (el.id === 'plume-auth-password') state.password = el.value
    if (el.id === 'plume-auth-confirm') state.confirm = el.value
    state.error = ''
  }
  function onKeydown(event: Event): void {
    if ((event as KeyboardEvent).key === 'Enter') void submit()
  }
  host.addEventListener('click', onClick)
  host.addEventListener('input', onInput)
  host.addEventListener('keydown', onKeydown)

  return {
    element: host,
    open(status) {
      state.configured = status.configured
      state.open = true
      host.style.display = 'flex'
      requestAnimationFrame(() => {
        const el = host.querySelector<HTMLInputElement>('#plume-auth-password')
        el?.focus()
      })
    },
    close() {
      state.open = false
      host.style.display = 'none'
    },
    destroy() {
      host.removeEventListener('click', onClick)
      host.removeEventListener('input', onInput)
      host.removeEventListener('keydown', onKeydown)
      app.unmount()
      host.remove()
    },
  }
}
