/**
 * 管理令牌的本机存取（前端一侧）。
 *
 * ## 为什么要一个公共模块
 *
 * 需要带令牌的地方有四处：插件管理面板、对话面板（`plugin-agent`）、
 * 云端连接（`plugin-cloud-client`）、视觉节点的宿主代发（`plugin-node-ui`）。
 * 如果各自写一个键名，用户填了面板却在对话里 403，表现是「有时候能用」——
 * 这种问题查起来最费时间。
 *
 * ## 为什么是 localStorage
 *
 * 它挡得住「别的网站」（不同源读不到），挡不住「已经装进画布的同源插件」。
 * 这是有意的取舍：dev（:5288）与后台跨源，拿不到 HttpOnly cookie；
 * 而且同源 XSS 一旦存在，cookie 也挡不住「用它发请求」。详见方案 4.4。
 */

/** 存储键。**只在这里出现一次**，其余地方一律走下面的函数。 */
export const ADMIN_TOKEN_KEY = 'mc_admin_token'

/** 请求头名（与后端 `adminAuth` 的读取保持一致） */
export const ADMIN_TOKEN_HEADER = 'x-admin-token'

type TokenStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 拿到可用的存储；SSR / 无 window / 被禁用时返回 undefined（调用方当"没有令牌"处理） */
function store(): TokenStore | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    return localStorage
  } catch {
    // Safari 隐私模式等：访问 localStorage 本身就会抛
    return undefined
  }
}

/** 读令牌；没存过/存的是空串都返回 undefined */
export function getAdminToken(): string | undefined {
  const s = store()
  if (!s) return undefined
  let v: string | null = null
  try {
    v = s.getItem(ADMIN_TOKEN_KEY)
  } catch {
    return undefined
  }
  const t = (v ?? '').trim()
  return t ? t : undefined
}

/** 存令牌（空串等于清除） */
export function setAdminToken(token: string): void {
  const s = store()
  if (!s) return
  const t = String(token ?? '').trim()
  try {
    if (t) s.setItem(ADMIN_TOKEN_KEY, t)
    else s.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    /* 存储满了/被禁用：不抛，调用方会看到下游 403 */
  }
}

export function clearAdminToken(): void {
  setAdminToken('')
}

/**
 * 给一组请求头补上令牌（没有令牌就原样返回）。
 *
 * 只在那些「首版要求令牌」的入口上调用；画布数据、KV 这类不要求令牌的请求
 * 不用带（带也无害，但会让预检多一个头）。
 */
export function withAdminToken(headers: Record<string, string> = {}): Record<string, string> {
  const t = getAdminToken()
  return t ? { ...headers, [ADMIN_TOKEN_HEADER]: t } : headers
}
