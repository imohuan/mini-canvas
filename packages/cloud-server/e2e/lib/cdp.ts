/**
 * 极简 CDP 客户端（零依赖，只用一个 WebSocket）。
 *
 * 为什么自己写而不装 playwright：本仓库不在任何包里依赖浏览器驱动，而端到端要验的
 * 恰恰是"真浏览器里能不能用"。Node 18+ 自带 WebSocket，直接连 Chrome 的调试端口就够，
 * 不必为此给仓库引入一个几百 MB 的依赖。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 一个 CDP 连接：send 命令、ev 求值、记录控制台错误与失败请求 */
export class CdpPage {
  /** 浏览器 console 里的 error 级输出（验收要求"控制台零报错"） */
  readonly consoleErrors: string[] = []
  /** 所有非 2xx 的请求（排查 404 噪音用） */
  readonly failedRequests: string[] = []
  private id = 0
  private readonly pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()

  private constructor(private readonly ws: WebSocket) {}

  static async attach(wsUrl: string): Promise<CdpPage> {
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res()
      ws.onerror = () => rej(new Error('无法连接 CDP: ' + wsUrl))
    })
    const page = new CdpPage(ws)
    ws.onmessage = (ev) => page.onMessage(String((ev as MessageEvent).data))
    return page
  }

  private onMessage(raw: string): void {
    const m = JSON.parse(raw)
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!
      this.pending.delete(m.id)
      if (m.error) p.rej(new Error(JSON.stringify(m.error)))
      else p.res(m.result)
      return
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      this.consoleErrors.push(m.params.args.map((a: any) => a.value ?? a.description ?? '').join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      this.consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? 'uncaught exception')
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      this.consoleErrors.push(m.params.entry.text)
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      this.failedRequests.push(`${m.params.response.status} ${m.params.response.url}`)
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error('CDP 超时: ' + method))
        }
      }, 30000)
    })
  }

  /** 在页面里求值（返回可 JSON 化的值） */
  async ev<T = any>(expression: string, awaitPromise = false): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
    }
    return r.result.value as T
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Log.enable')
    await this.send('Network.enable')
    await this.send('Page.navigate', { url })
  }

  close(): void {
    this.ws.close()
  }
}

export interface ChromeHandle {
  /** 调试端口 */
  port: number
  /** 用过的临时 profile 目录（等于"另一台机器"） */
  profile: string
  kill(): void
}

/**
 * 起一个 headless Chrome。每次调用都给一个**全新 profile** —— 这正是验收里
 * "换一台机器/换一个浏览器"那条：localStorage 是空的，只有服务端数据能救回画布。
 *
 * @param chromePath chrome/edge 可执行文件路径；不传则按平台常见位置探测
 */
export async function launchChrome(chromePath?: string): Promise<ChromeHandle> {
  const exe = chromePath ?? findChrome()
  const port = 9200 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'mini-canvas-e2e-'))
  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await waitForCdp(port)
  return {
    port,
    profile,
    kill: () => child.kill(),
  }
}

/** 等调试端口起来（最多 20 秒） */
async function waitForCdp(port: number): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口未就绪，可能没装 Chrome/Edge 或启动失败')
}

/** 开一个新标签页并连上它 */
export async function openPage(port: number): Promise<CdpPage> {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  })
  const tab = (await r.json()) as { webSocketDebuggerUrl: string }
  return CdpPage.attach(tab.webSocketDebuggerUrl)
}

/** 按平台常见位置找浏览器 */
function findChrome(): string {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    throw new Error(`找不到浏览器，请用 --chrome <路径> 指定。已尝试：\n${candidates.join('\n')}`)
  }
  return found
}
