import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { withAdminToken } from '@plume-canvas/canvas-base'
import {
  UI_DEBUG_INVITE_KEY,
  appendSdkScript,
  buildSdkScriptBody,
  clearCredential,
  readCredential,
  readInvite,
  writeCredential,
} from '../debugSession'
import { emitUiDebugEvent } from '../debugEventBus'
import { openDebugWindow } from '../debugWindow'
import { errText } from '../hostFetch'
import { feedbackService } from '@plume-canvas/canvas-render'

export interface DebugWindow {
  readonly closed: boolean
  addEventListener(t: string, fn: () => void): void
  close(): void
  location: { href: string }
}

export interface UseUiDebugWindowOptions {
  ctx: { tryGet<T = unknown>(name: string): T | undefined }
  nodeId: string
  data: Record<string, unknown>
  canvasId: string
  baseUrl(): string
  hasHtml(): boolean
  html(): string
  inputValues(): Record<string, unknown>
  upstream: Ref<unknown>
  srcdoc(): string
  debugSession: { value: string }
  gen: { value: number }
  updateNodeForDebug(prev: Record<string, unknown>, patch: Record<string, unknown>): void
}

/** sessionStorage 的安全访问：SSR / 隐私模式里可能不存在或抛错 —— 一律按「没凭据」降级 */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
  } catch {
    return undefined
  }
}

/** 读凭据的环境安全版（storage 不在 = 没凭据） */
function loadCred() {
  const st = safeStorage()
  return st ? readCredential(st) : undefined
}

/**
 * 调试窗口与调试连接状态机。
 *
 * 原样搬出 UiContent.vue；邀请确认、SDK 注入、刷新拦截、窗口重发与断开清理顺序不变。
 */
export function useUiDebugWindow(options: UseUiDebugWindowOptions) {
  const gen = options.gen
  /** 当前开着的调试窗口（空 = 没开） */
  const debugWin = ref<DebugWindow | null>(null)
  /** 参数 / 上游变了以后，攒一下再重发（不然拖一次滑杆能发几十次请求） */
  let debugTimer: ReturnType<typeof setTimeout> | null = null
  let lastDebugSig = ''

  const pendingInvite = computed(() => readInvite(options.data))

  /** 是否该弹确认框：有邀请、且本标签页还不是那个被选中的（凭据对不上这个邀请） */
  const showDebugPrompt = computed(() => {
    const inv = pendingInvite.value
    if (!inv) return false
    const cred = loadCred()
    if (cred && cred.session === inv.session && cred.nodeId === options.nodeId && cred.canvasId === options.canvasId) return false
    return true
  })

  /** 调试态 = 本标签页持有对得上当前节点的凭据 */
  const activeDebug = computed(() => {
    void options.debugSession.value
    const cred = loadCred()
    if (!cred || cred.nodeId !== options.nodeId || cred.canvasId !== options.canvasId) return false
    const inv = readInvite(options.data)
    if (inv) return cred.session === inv.session
    return options.debugSession.value === cred.session
  })

  /** 画布把视线带到本节点（选中 + 居中）。 */
  function focusThisNode(): void {
    try {
      options.ctx.tryGet<{ set(ids: Iterable<string>): void }>('selection')?.set([options.nodeId])
      const cmd = options.ctx.tryGet<{ runCommand(id: string): unknown }>('canvas')
      if (cmd && typeof cmd.runCommand === 'function') {
        cmd.runCommand('auto-layout:focus-selected')
      } else {
        console.log('[ui-debug] command 服务不可用，cmd =', typeof cmd)
      }
    } catch (err) {
      console.log('[ui-debug] 聚焦异常:', (err as Error)?.message ?? err)
    }
  }

  watch(pendingInvite, (inv, old) => {
    if (inv && !old) {
      console.log('[ui-debug] 邀请出现，聚焦节点 ' + options.nodeId)
      focusThisNode()
    }
  })

  async function acceptDebugInvite(): Promise<void> {
    const inv = pendingInvite.value
    if (!inv) return
    console.log('[ui-debug] accept clicked, inv.session=' + inv.session)
    const st = safeStorage()
    if (!st) return
    writeCredential(st, {
      session: inv.session,
      nodeId: options.nodeId,
      canvasId: options.canvasId,
      at: Date.now(),
    })
    options.debugSession.value = inv.session
    emitUiDebugEvent({ nodeId: options.nodeId, kind: 'connected' })
    console.log('[ui-debug] debugSession set to ' + options.debugSession.value)
    try {
      const res = await fetch(options.baseUrl() + '/api/node-ui/debug-accept', {
        method: 'POST',
        headers: withAdminToken({ 'content-type': 'application/json' }),
        body: JSON.stringify({ session: inv.session, nodeId: options.nodeId, canvasId: options.canvasId }),
      })
      console.log('[ui-debug] 回执后台: status=' + res.status, 'baseUrl=' + options.baseUrl())
    } catch (err) {
      console.log('[ui-debug] 回执后台失败:', (err as Error)?.message ?? err, 'baseUrl=' + options.baseUrl())
    }
    try {
      const doc = options.ctx.tryGet<{
        updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
      }>('doc')
      doc?.updateNodeRuntime(options.nodeId, { data: { [UI_DEBUG_INVITE_KEY]: null } })
    } catch {
      /* 节点可能刚被删：无妨，凭据已写，刷新恢复逻辑靠 sessionStorage */
    }
  }

  /** 用户点「拒绝」：不写凭据。框的显隐跟着邀请标记走。 */
  function dismissDebugInvite(): void {
    /* 故意空：什么都不做，框随标记存在。用户想关掉只能让 Agent disconnect */
  }

  /** 调试态在 srcdoc 末尾追加 SDK；依赖 debugSession 以换会话时重算。 */
  const frameDoc = computed(() => {
    const base = options.srcdoc()
    void options.debugSession.value
    if (!base || !activeDebug.value) return base
    const cred = safeStorage() ? loadCred() : undefined
    if (!cred) {
      console.log('[ui-debug] 调试态但没有凭据，SDK 不注入')
      return base
    }
    console.log('[ui-debug] 注入 SDK: session=' + cred.session, 'baseUrl=' + options.baseUrl())
    return appendSdkScript(base, buildSdkScriptBody({
      baseUrl: options.baseUrl(),
      session: cred.session,
      canvasId: options.canvasId,
      nodeId: options.nodeId,
    }))
  })

  // 调试态切换（首次同意 / 换会话）也要重挂：只改 srcdoc 属性浏览器**不会重跑脚本**，
  // 表现就是「点了同意调试，SDK 还是连不上」。
  watch(frameDoc, () => { gen.value += 1 })

  function onDebugBeforeUnload(e: BeforeUnloadEvent): void {
    if (!activeDebug.value) return
    e.preventDefault()
    e.returnValue = ''
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', onDebugBeforeUnload)
  }

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onDebugBeforeUnload)
    if (activeDebug.value) {
      const st = safeStorage()
      if (st) clearCredential(st)
    }
  })

  /** 把当前这份界面 + 数据写到调试源，返回可打开的 URL。 */
  async function pushDebugDocs(
    force = false,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string; skip?: boolean }> {
    const payload = {
      nodeId: options.nodeId,
      html: options.html(),
      inputs: options.inputValues(),
      upstream: options.upstream.value,
    }
    const sig = JSON.stringify(payload)
    if (!force && sig === lastDebugSig) return { ok: false, error: '', skip: true }
    try {
      const res = await fetch(options.baseUrl() + '/api/canvases/' + encodeURIComponent(options.canvasId) + '/debug-docs', {
        method: 'POST',
        headers: withAdminToken({ 'content-type': 'application/json' }),
        body: sig,
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: unknown; urls?: { html?: unknown }; error?: unknown }
      if (!res.ok || json.ok !== true) {
        const why = typeof json.error === 'string' && json.error ? json.error : 'HTTP ' + res.status
        return { ok: false, error: '调试页没生成出来：' + why }
      }
      const url = json.urls && typeof json.urls.html === 'string' ? json.urls.html : ''
      if (!url) return { ok: false, error: '调试页没生成出来：后台没给地址' }
      lastDebugSig = sig
      return { ok: true, url }
    } catch (err) {
      return { ok: false, error: '调试页没生成出来：' + errText(err) }
    }
  }

  async function openDebug(): Promise<void> {
    if (!options.hasHtml()) return
    const r = await openDebugWindow({
      openWindow: () =>
        window.open('about:blank', 'plume-ui-debug-' + options.nodeId, 'width=960,height=720') as unknown as DebugWindow | null,
      fetchDocUrl: async () => {
        const made = await pushDebugDocs(true)
        return made.ok ? made : { ok: false as const, error: made.error }
      },
      // 禁止浏览器原生 alert：统一交给应用级反馈服务。它没有返回值，这里不 await，
      // 开窗流程仍按原时序继续（提示只是告知，不改变决策）。
      alert: (m) => {
        const feedback = feedbackService()
        if (feedback) void feedback.alert({ title: '调试窗口', description: m })
        else console.warn('[node-ui] ' + m)
      },
    })
    if (!r.ok) return

    const win = r.win as unknown as DebugWindow
    debugWin.value = win
    try {
      win.addEventListener('pagehide', () => {
        setTimeout(() => {
          if (win.closed) clearDebugWindow(win)
        }, 0)
      })
    } catch {
      /* 跨源之后挂不上：靠 watch 里的 closed 判断兜底 */
    }
  }

  /**
   * 调试窗口开着时，参数 / 上游 / 界面一变就把新数据重发过去（攒 300ms）。
   *
   * 为什么窗口关着就不发：那等于每次改参数都往磁盘写三份文件，纯浪费。
   */
  watch([options.upstream, options.inputValues, options.html], () => {
    const win = debugWin.value
    if (!win) return
    if (win.closed) {
      clearDebugWindow(win)
      return
    }
    if (debugTimer) clearTimeout(debugTimer)
    debugTimer = setTimeout(() => {
      debugTimer = null
      void pushDebugDocs().then((r) => {
        if (!r.ok && !r.skip) console.warn('[ui-debug] 重发调试数据失败：' + r.error)
      })
    }, 300)
  })

  /** 窗口真的没了：清引用 + 撤掉还没发的重发任务 */
  function clearDebugWindow(win: DebugWindow): void {
    if (debugWin.value === win) debugWin.value = null
    if (debugTimer) {
      clearTimeout(debugTimer)
      debugTimer = null
    }
  }

  /** 调试页上报：入口只负责来源校验，三个副作用的接线仍由入口完成。 */
  function onDebugMessage(
    ev: MessageEvent,
    handlers: {
      proxy(win: Window, reqId: string, m: Record<string, unknown>): void
      applyOutput(url: string, name: string, text?: string): void
      isOwnResourceUrl(url: string): boolean
    },
  ): void {
    const win = debugWin.value
    if (!win || ev.source !== win) return
    const m = ev.data as
      | ({
          __canvasUiDebug?: unknown
          type?: unknown
          name?: unknown
          text?: unknown
          url?: unknown
        } & Record<string, unknown>)
      | null
    if (!m || m.__canvasUiDebug !== 1) return
    try {
      if ((m.type === 'api' || m.type === 'task' || m.type === 'task-cancel') && typeof m.reqId === 'string') {
        handlers.proxy(win as unknown as Window, m.reqId, m)
        return
      }
      if (m.type === 'saved' && typeof m.url === 'string' && m.url) {
        if (!handlers.isOwnResourceUrl(m.url)) return
        handlers.applyOutput(
          m.url,
          typeof m.name === 'string' && m.name ? m.name : 'out.png',
          typeof m.text === 'string' ? m.text : undefined,
        )
        return
      }
      if (m.type === 'token-stale') {
        if (debugTimer) clearTimeout(debugTimer)
        debugTimer = setTimeout(() => {
          debugTimer = null
          void pushDebugDocs(true).then((r) => {
            if (!r.ok) console.warn('[ui-debug] 重签调试令牌失败：' + r.error)
          })
        }, 0)
        return
      }
      if (m.type === 'state') {
        const st = ev.data as { state?: unknown }
        const patch = st.state && typeof st.state === 'object' ? (st.state as Record<string, unknown>) : { value: st.state }
        const prev = (options.data?.uiInputs ?? {}) as Record<string, unknown>
        options.updateNodeForDebug(prev, patch)
      }
    } catch {
      /* 节点可能已被删掉：静默跳过（不该因为一次上报把调试搞崩） */
    }
  }

  /**
   * iframe 内 SDK 的调试动作上报（__uiDebugEvt）→ 调试事件总线。
   * 只认本节点这个 iframe；disconnected 时清凭据并清空会话。
   */
  function onDebugSdkEvent(ev: MessageEvent, win: Window | null): void {
    if (!win || ev.source !== win) return
    const m = ev.data as { __uiDebugEvt?: { kind?: unknown; detail?: unknown } } | null
    if (!m || !m.__uiDebugEvt || typeof m.__uiDebugEvt.kind !== 'string') return
    if (m.__uiDebugEvt.kind === 'disconnected') {
      console.log('[ui-debug] 后台断开：清凭据 + 摘刷新拦截')
      const st2 = safeStorage()
      if (st2) clearCredential(st2)
      options.debugSession.value = ''
      emitUiDebugEvent({ nodeId: options.nodeId, kind: 'disconnected' })
      return
    }
    emitUiDebugEvent({
      nodeId: options.nodeId,
      kind: m.__uiDebugEvt.kind as 'eval' | 'result' | 'error' | 'disconnected',
      ...(typeof m.__uiDebugEvt.detail === 'string' ? { detail: m.__uiDebugEvt.detail } : {}),
    })
  }

  /** 卸载时：关窗口、清监听与暂存计时器。 */
  function dispose(): void {
    if (debugTimer) {
      clearTimeout(debugTimer)
      debugTimer = null
    }
    debugWin.value?.close()
    debugWin.value = null
  }

  return {
    debugWin,
    pendingInvite,
    showDebugPrompt,
    activeDebug,
    frameDoc,
    openDebug,
    clearDebugWindow,
    pushDebugDocs,
    onDebugMessage,
    onDebugSdkEvent,
    acceptDebugInvite,
    dismissDebugInvite,
    dispose,
  }
}
