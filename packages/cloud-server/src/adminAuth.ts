/**
 * 管理令牌：从固定环境变量或数据目录里的文件取一个 64 位 hex 令牌。
 *
 * 固定令牌优先：设了就不读也不写文件，避免「改了文件为什么没用」。
 * 比较一律走 timingSafeEqual；长度不同先返回 bad，避免它抛异常。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AuditAction } from './audit.js'

export interface AdminAuth {
  readonly token: string
  readonly tokenFile: string | null
  readonly source: 'file' | 'env' | 'disabled'
  verify(v: string | undefined): 'ok' | 'missing' | 'bad'
}

/** 任意写方法都保护的路径前缀（结尾带斜杠，避免误伤同名前缀的兄弟路径）。 */
export const ADMIN_WRITE_PREFIXES = [
  '/api/server-plugins/',
  '/api/npm-plugins/',
  '/api/agent/mcp',
  '/api/agent/skills',
  '/api/agent/system-prompt',
  '/api/agent/template/',
  '/api/agent/prompts',
  '/api/agent/policy',
  '/api/agent/title-model',
  '/api/agent/models',
  '/api/agent/chat/completion',
  '/api/task/',
  '/api/node-packages/',
  '/api/node-ui/debug-',
  '/api/style-library/',
  '/api/effect-library/',
  '/api/showcase/',
  '/api/agent/canvases/',
  '/api/jobs',
] as const

/** 只保护 POST 的路径前缀：PUT 是整画布保存，首版不在范围。 */
export const ADMIN_POST_ONLY_PREFIXES = ['/api/canvases/', '/api/canvas/'] as const

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 前缀匹配：带尾斜杠的前缀按「目录」算；不带尾斜杠的必须**整段相等**或后面接 `/`。
 *
 * 2026-10-20 审查：原来对不带的直接 `startsWith`，`/api/jobs` 会连带保护 `/api/jobsfoo`、
 * `/api/agent/mcp` 会连带 `/api/agent/mcpfoo`。方向是「多保护」，不会漏，但会和注释说的
 * 「避免误伤兄弟路径」相反，也让排查 403 时多一层困惑。
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix) || pathname === prefix.slice(0, -1)
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** method + path 判断是否受令牌保护（首版白名单）。 */
export function isAdminPath(method: string, pathname: string): boolean {
  if (!WRITE_METHODS.has(method)) return false
  if (ADMIN_WRITE_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return true
  if (method === 'POST' && ADMIN_POST_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return true
  return false
}

/**
 * 把「受保护的写入口」归类成审计里的 action（审计日志用它回答「谁改了什么」）。
 *
 * 只做路径归类，不判断令牌：调用方拿到 action 后自己记 attempt / ok / rejected。
 */
export function adminActionFor(method: string, pathname: string): AuditAction {
  if (pathname.startsWith('/api/canvases/')) return method.toUpperCase() === 'PUT' ? 'canvas/overwrite' : 'canvas/write'
  if (pathname.startsWith('/api/canvas/')) return 'canvas/write'
  if (pathname.startsWith('/api/task/')) return 'task/call'
  if (pathname.startsWith('/api/agent/canvases/')) return 'agent/session-write'
  if (pathname.startsWith('/api/agent/mcp')) return pathname.includes('/remove') ? 'agent/mcp-remove' : 'agent/mcp-add'
  if (pathname.startsWith('/api/server-plugins/')) return 'server-plugin/install'
  if (pathname.startsWith('/api/npm-plugins/')) return 'npm-plugin/install'
  return 'write'
}

const TOKEN_RE = /^[0-9a-f]{64}$/i

function verifyWith(expected: string, v: string | undefined): 'ok' | 'missing' | 'bad' {
  if (v === undefined || v === '') return 'missing'
  const got = Buffer.from(v, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (got.length !== want.length) return 'bad'
  return timingSafeEqual(got, want) ? 'ok' : 'bad'
}

export async function createAdminAuth(opts: {
  dataDir: string
  enabled?: boolean
  fixedToken?: string
}): Promise<AdminAuth> {
  if (opts.enabled === false) {
    return {
      token: '',
      tokenFile: null,
      source: 'disabled',
      verify: () => 'ok',
    }
  }

  const fixed = opts.fixedToken ?? process.env.MINI_CANVAS_ADMIN_TOKEN
  if (fixed) {
    return {
      token: fixed,
      tokenFile: null,
      source: 'env',
      verify: (v) => verifyWith(fixed, v),
    }
  }

  await fs.mkdir(opts.dataDir, { recursive: true })
  const tokenFile = path.join(opts.dataDir, 'admin-token')
  let token: string | undefined
  try {
    const raw = (await fs.readFile(tokenFile, 'utf8')).trim()
    if (TOKEN_RE.test(raw)) token = raw
    else console.warn('[admin-auth] 令牌文件格式不合法，已重新生成：' + tokenFile)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[admin-auth] 读取令牌文件失败，将重新生成：' + tokenFile)
    }
  }

  if (!token) {
    token = randomBytes(32).toString('hex')
    // 创建时就带 0o600；Windows 会忽略 mode，下面再按平台收紧。
    await fs.writeFile(tokenFile, token, { encoding: 'utf8', mode: 0o600 })
    if (process.platform !== 'win32') {
      await fs.chmod(tokenFile, 0o600)
    }
    // Windows 上不调用 icacls：它在部分测试环境不可用，也容易把文件锁住。
    // 需要更严格的 ACL 时，由部署文档单独说明。
  }

  const expected = token
  return {
    token: expected,
    tokenFile,
    source: 'file',
    verify: (v) => verifyWith(expected, v),
  }
}
