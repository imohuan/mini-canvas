/**
 * 登录（cloud-client 一侧）：首启设置密码、之后输入密码、退出登录。
 *
 * 为什么画在这里而不是 plugin-manager：用户口径 2026-11-12 —— 认证与它的界面
 * 都归 cloud-client；插件管理页只负责装卸。
 *
 * 为什么不用 Vue：本插件产物是「零 import 自包含 ESM」（见 vite.config.ts）。
 * 引入 Vue 会把第二份 Vue 实例打进产物，组件挂不上去。所以这里用原生 DOM + 主题变量，
 * 观感仍跟随主题（颜色全部取 `--ui-*`）。
 *
 * 安全边界：令牌只交给后台校验，浏览器不保存明文；成功后后台发 HttpOnly 会话 cookie。
 */
import type { FetchLike } from './apiTypes.js'

export interface AuthStatus {
  enabled: boolean
  configured: boolean
  authed: boolean
  local: boolean
}

export interface CloudAuthOptions {
  /** 服务根地址（空串 = 同源） */
  baseUrl: string
  fetchImpl?: FetchLike
  /** 登录状态变化（遮罩自己会先调一次，外部订阅者据此刷新界面） */
  onChange?: (status: AuthStatus) => void
}

const MIN_LEN = 5

/** 登录客户端：只发四个请求，不碰 localStorage */
export class CloudAuth {
  private baseUrl: string
  private readonly doFetch: FetchLike
  private statusValue: AuthStatus = { enabled: true, configured: false, authed: false, local: false }

  constructor(private readonly opts: CloudAuthOptions) {
    this.baseUrl = normalizeBase(opts.baseUrl)
    const raw = opts.fetchImpl ?? ((url, init) => fetch(url, init))
    // 带 cookie：登录状态在 HttpOnly cookie 里，前端读不到也不需要读
    this.doFetch = (url, init) => raw(url, { ...(init ?? {}), credentials: 'include' })
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = normalizeBase(baseUrl)
  }

  status(): AuthStatus {
    return { ...this.statusValue }
  }

  private url(path: string): string {
    return (this.baseUrl || '') + path
  }

  private emit(next: AuthStatus): void {
    this.statusValue = next
    try {
      this.opts.onChange?.(next)
    } catch {
      /* 单个订阅者报错不影响登录本身 */
    }
  }

  /** 问后台：设过令牌没有、这个浏览器登录了没有 */
  async refresh(): Promise<AuthStatus> {
    try {
      const res = await this.doFetch(this.url('/api/auth/status'), { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('status ' + res.status)
      const body = (await res.json()) as Partial<AuthStatus>
      const next: AuthStatus = {
        enabled: body.enabled !== false,
        configured: body.configured === true,
        authed: body.authed === true,
        local: body.local === true,
      }
      this.emit(next)
      return next
    } catch {
      // 后台没起 / 不是托管版：当作“不需要登录”，避免把界面锁死在错误状态
      const next: AuthStatus = { enabled: false, configured: true, authed: true, local: true }
      this.emit(next)
      return next
    }
  }

  /** 首次设置自定义令牌（后台只允许本机、只允许一次） */
  async setup(token: string): Promise<string | undefined> {
    return this.send('/api/auth/setup', { token }, '设置密码')
  }

  async login(token: string): Promise<string | undefined> {
    return this.send('/api/auth/login', { token }, '登录')
  }

  async logout(): Promise<void> {
    try {
      await this.doFetch(this.url('/api/auth/logout'), { method: 'POST' })
    } catch {
      /* 退出失败也让界面回到登录态：cookie 过期同样会要求登录 */
    }
    this.emit({ ...this.statusValue, authed: false })
  }

  private async send(path: string, body: unknown, what: string): Promise<string | undefined> {
    let res: Response
    try {
      res = await this.doFetch(this.url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      return '连不上后台，请确认服务已启动'
    }
    const parsed = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || parsed.ok === false) {
      return parsed.error ?? what + '失败（' + res.status + '）'
    }
    const next = await this.refresh()
    if (!next.authed) return what + '成功，但登录状态没保持住（检查浏览器是否禁用了 cookie）'
    return undefined
  }
}

function normalizeBase(raw: string): string {
  const t = String(raw ?? '').trim()
  return t ? t.replace(/\/+$/, '') : ''
}

/** 校验用户输入的令牌（与后台同一条规则：最短 5 位） */
export function validateTokenInput(token: string): string | undefined {
  return token.trim().length < MIN_LEN ? '密码至少要 ' + MIN_LEN + ' 位' : undefined
}

