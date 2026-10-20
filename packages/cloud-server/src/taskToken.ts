/**
 * 任务脚本令牌：只允许「写自己这个节点的槽位」。
 *
 * ## 为什么需要它
 *
 * 任务脚本（`plugin-node-ui` 的 `task/call`）跑在**独立 Node 子进程**里，产物靠
 * `ctx.save` 直接 POST `/api/canvases/:id/resources?slot=<节点>`。首版给这条路由加了
 * 管理令牌之后，子进程会被 403；但**绝不能把管理令牌发给子进程** —— 那等于把
 * 「装插件 / 改画布 / 跑命令」的最高权限交给每一段用户脚本（方案第十七节）。
 *
 * 所以另签一类令牌：绑定 `canvasId + nodeId`，只管这一个槽位的写入，几分钟后失效。
 *
 * ## 做法
 *
 * 无状态：`payload = base64url(JSON)`，`sig = HMAC-SHA256(secret, payload)`，
 * 令牌 = `payload.sig`。密钥在进程启动时随机生成（重启即全部失效，符合「短时」语义）。
 * 校验时同时看：签名、过期、canvasId、slot 是否**恰好**这个节点。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface TaskTokenClaims {
  /** 画布 id */
  c: string
  /** 节点 id（= 允许写的槽位） */
  n: string
  /** 过期时间（毫秒时间戳） */
  exp: number
}

export interface TaskTokens {
  /** 签一个只允许写 `canvasId/nodeId` 槽位的令牌 */
  issue(canvasId: string, nodeId: string, ttlMs?: number): string
  /** 校验：签名对、没过期、且 canvasId/slot 正好匹配 */
  verify(token: string | undefined, canvasId: string, slot: string): boolean
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function createTaskTokens(opts: { secret?: Buffer; now?: () => number } = {}): TaskTokens {
  const secret = opts.secret ?? randomBytes(32)
  const now = opts.now ?? (() => Date.now())

  function sign(payload: string): string {
    return b64url(createHmac('sha256', secret).update(payload).digest())
  }

  return {
    issue(canvasId, nodeId, ttlMs = 10 * 60 * 1000) {
      const claims: TaskTokenClaims = { c: canvasId, n: nodeId, exp: now() + ttlMs }
      const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
      return payload + '.' + sign(payload)
    },

    verify(token, canvasId, slot) {
      if (!token) return false
      const dot = token.indexOf('.')
      if (dot <= 0) return false
      const payload = token.slice(0, dot)
      const sig = token.slice(dot + 1)
      const want = sign(payload)
      // 长度不同要先把 timingSafeEqual 挡掉（它会抛）
      const a = Buffer.from(sig)
      const b = Buffer.from(want)
      if (a.length !== b.length || !timingSafeEqual(a, b)) return false
      let claims: TaskTokenClaims
      try {
        claims = JSON.parse(unb64url(payload).toString('utf8')) as TaskTokenClaims
      } catch {
        return false
      }
      if (!claims || typeof claims.c !== 'string' || typeof claims.n !== 'string') return false
      if (typeof claims.exp !== 'number' || claims.exp < now()) return false
      return claims.c === canvasId && claims.n === slot
    },
  }
}
