/**
 * errorDiagnosis —— 把一条错误文本读成「在哪出错 / 什么层 / 什么状态码」。
 *
 * 为什么要这一步（用户 2026-11-07）：错误标题原来只有「Failed: EPERM: operation not permitted, rename ...」，
 * 用户看不出这是**后台写文件失败**、**后台接口返回 4xx/5xx**，还是**前端自己报错**；
 * 更看不出 400 与 504 是两种完全不同的病。标题要一眼说清，展开区再给细节。
 *
 * 纯函数、零 Vue、零 DOM：界面只负责按结论画。
 */

/** 出错的层：谁捕获 / 谁该负责 */
export type ErrorLayer = 'server' | 'client' | 'network' | 'browser' | 'unknown'

export interface ErrorDiagnosis {
  layer: ErrorLayer
  /** 一句话层级名（标题最前面那段），如「后台写入失败」「后台接口 504」「前端请求失败」 */
  headline: string
  /** 具体原因（第二段）：状态码 + 原因短语，或 Node 的 errno 说明 */
  reason: string
  /** HTTP 状态码（有就带上，界面可以标色） */
  status?: number
  /** 捕获位置（文件 / 函数 / 路由），给展开区第一行用 */
  where?: string
  /** 一句话人话解释：这个错误通常意味着什么（尽量短） */
  hint?: string
}

/** HTTP 状态码 → 一句人话（只覆盖常见几种，其余按 4xx / 5xx 兜底） */
const HTTP_HINT: Record<number, string> = {
  400: '请求参数不对，后台拒收',
  401: '没登录 / 令牌失效',
  403: '没有权限',
  404: '地址或对象不存在',
  409: '和已有数据冲突',
  413: '内容太大，超过了上限',
  422: '参数格式对但内容不合法',
  429: '请求太快，被限流了',
  500: '后台自己出错了',
  502: '上游服务回了坏响应',
  503: '服务暂时不可用（可能正在重启）',
  504: '后台等上游超时了',
}

/** Node 常见 errno → 人话 + 通常是谁的问题 */
const ERRNO: Record<string, { reason: string; hint: string }> = {
  EPERM: { reason: 'EPERM 不允许的操作', hint: 'Windows 上文件被占用 / 只读目录，常见于后台写会话文件' },
  EACCES: { reason: 'EACCES 没有访问权限', hint: '目录权限不足，后台无法读写这个位置' },
  ENOENT: { reason: 'ENOENT 文件或目录不存在', hint: '路径拼错，或目标已被删掉' },
  EBUSY: { reason: 'EBUSY 文件被占用', hint: '另一个进程正握着这个文件（编辑器 / 杀毒软件）' },
  ENOSPC: { reason: 'ENOSPC 磁盘空间不足', hint: '清一下磁盘再试' },
  EEXIST: { reason: 'EEXIST 目标已存在', hint: '写入前应先把旧的目标清掉或换名' },
  EISDIR: { reason: 'EISDIR 期望文件却是目录', hint: '路径写错了层级' },
  ETIMEDOUT: { reason: 'ETIMEDOUT 超时', hint: '对方迟迟没回，通常是网络或上游任务卡住' },
  ECONNREFUSED: { reason: 'ECONNREFUSED 连接被拒', hint: '目标端口没人监听（后台没起 / 端口写错）' },
  ECONNRESET: { reason: 'ECONNRESET 连接被重置', hint: '连接中途断了，重试一次通常能好' },
  EPIPE: { reason: 'EPIPE 管道已关闭', hint: '对端提前退出，写不进去了' },
}

/** 取错误文本的第一条非空行 */
function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

/**
 * 从文本里抠 HTTP 状态码。
 *
 * 认这几种真实出现过的写法：
 *   · `HTTP 504` / `status 504` / `status: 504` / `statusCode=504`
 *   · `504 Gateway Timeout`（状态码 + 标准原因短语，中间可带冒号）
 *   · fetch 的 `Failed to load resource: the server responded with a status of 504`
 * 不认单纯的数字（正文里的年份、端口号会误伤）。
 */
export function httpStatusOf(text: string): number | undefined {
  const patterns = [
    /\bHTTP[/ ]?(\d{3})\b/i,
    /\bstatus(?:Code)?\s*[:=]?\s*(\d{3})\b/i,
    /\b(\d{3})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Payload Too Large|Unprocessable|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i,
    /responded with a status of (\d{3})/i,
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const code = Number(m[1])
    if (code >= 400 && code <= 599) return code
  }
  return undefined
}

/** 状态码 → 与层级相关的一句结论 */
function statusVerdict(code: number): { layer: ErrorLayer; headline: string; hint: string } {
  // 502/503/504 是**网关/上游**的问题：后台自己活着，但它等的人出事了
  if (code === 502 || code === 503 || code === 504) {
    return {
      layer: 'server',
      headline: '后台接口 ' + code + '（上游超时 / 不可用）',
      hint: HTTP_HINT[code],
    }
  }
  // 5xx：后台自身故障
  if (code >= 500) return { layer: 'server', headline: '后台接口 ' + code + '（后台故障）', hint: HTTP_HINT[code] ?? '后台内部出错' }
  // 4xx：请求方（我们的前端）发错了
  return {
    layer: 'client',
    headline: '后台接口 ' + code + '（请求方参数 / 权限问题）',
    hint: HTTP_HINT[code] ?? '前端发出的请求不被接受',
  }
}

/** 从堆栈里挑一个「最像业务代码」的帧（跳过 node_modules / vite 内部） */
function appFrameOf(text: string): string | undefined {
  const frames = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return frames.find(
    (l) => /^at\s/.test(l) && !l.includes('node_modules') && !l.includes('/@vite/') && !l.includes('node:internal'),
  )
}

/**
 * 主入口：把一段错误文本读成结论。
 *
 * 判定顺序（先确定「在哪里」，再决定「是哪一层」）：
 *   1. HTTP 状态码 —— 有状态码就一定是「某次请求的回应」，层级按 4xx / 5xx 分；
 *   2. 明确提到后台路由（/api/...）或后台日志前缀（[agentSessionStore] 等）→ 后台；
 *   3. Node errno（EPERM/EACCES…）→ 后台文件系统；
 *   4. 浏览器专属错误（TypeError: Failed to fetch / NetworkError / CORS）→ 网络；
 *   5. Vue / 前端堆栈 → 前端；
 *   6. 都认不出 → 保持原来的错误文本当标题（不硬编一个假结论）。
 */
export function diagnoseError(text: string | undefined): ErrorDiagnosis {
  const raw = String(text ?? '').trim()
  if (!raw) return { layer: 'unknown', headline: '未知错误', reason: '没有错误信息' }
  const line = firstLine(raw)
  const where = appFrameOf(raw)

  // ① 有 HTTP 状态码：先按状态码定性
  const status = httpStatusOf(raw)
  if (status !== undefined) {
    const verdict = statusVerdict(status)
    const route = /(?:GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s,)]+)/i.exec(raw)?.[0]
      ?? /(\/api\/[^\s,)]+)/.exec(raw)?.[1]
    return {
      layer: verdict.layer,
      headline: verdict.headline,
      reason: line.slice(0, 160),
      status,
      ...(route ? { where: route } : where ? { where } : {}),
      hint: verdict.hint,
    }
  }

  // ② 后台文件系统（Node errno）
  // 长度放宽到 20：ECONNREFUSED / ENETUNREACH 这类比 EPERM 长得多
  const errno = /\b(E[A-Z]{2,20})\b/.exec(raw)?.[1]
  if (errno && ERRNO[errno]) {
    const info = ERRNO[errno]
    const op = /\b(rename|open|read|write|unlink|mkdir|stat|copyfile)\b/i.exec(line)?.[1]
    return {
      layer: 'server',
      headline: '后台写文件失败（' + (op ? op + ' ' : '') + errno + '）',
      reason: info.reason,
      ...(where ? { where } : {}),
      hint: info.hint,
    }
  }

  // ③ 浏览器 / 网络层（没有状态码，请求根本没到后台，或跨域被挡）
  if (/Failed to fetch|NetworkError|Load failed|net::ERR_|CORS|Mixed Content/i.test(raw)) {
    const code = /net::(ERR_[A-Z_]+)/i.exec(raw)?.[1]
    return {
      layer: 'network',
      headline: '网络请求没发出去（前端 → 后台）',
      reason: code ? code : line.slice(0, 160),
      ...(where ? { where } : {}),
      hint: code === 'ERR_CONNECTION_REFUSED' ? '后台没起 / 端口不对' : '检查后台是否在跑、地址是否正确',
    }
  }

  // ④ 明确的后台路由 / 后台日志前缀
  const apiPath = /(\/api\/[A-Za-z0-9_\-/]+)/.exec(raw)?.[1]
  const serverLog = /^\[([a-zA-Z][\w:-]*)\]/.exec(line)?.[1]
  if (apiPath || serverLog || /\b(cloud-server|plugin-agent\/server)\b/.test(raw)) {
    return {
      layer: 'server',
      headline: '后台报错',
      reason: line.slice(0, 160),
      ...(apiPath ? { where: apiPath } : serverLog ? { where: '[' + serverLog + ']' } : where ? { where } : {}),
    }
  }

  // ⑤ 前端：堆栈里是我们自己的源码，或典型的前端异常
  if (/\.(vue|ts|tsx|js):\d+/.test(raw) || /Vue warn|Cannot read propert|is not a function|undefined is not/i.test(raw)) {
    return {
      layer: 'client',
      headline: '前端报错',
      reason: line.slice(0, 160),
      ...(where ? { where } : {}),
    }
  }

  // ⑥ 认不出：如实展示原文，不编结论
  return { layer: 'unknown', headline: line.slice(0, 120), reason: line.slice(0, 160) }
}

/** 层 → 中文名（展开区「位置」那一行用） */
export function layerLabel(layer: ErrorLayer): string {
  if (layer === 'server') return '后台'
  if (layer === 'client') return '前端'
  if (layer === 'network') return '网络'
  if (layer === 'browser') return '浏览器'
  return '未知'
}
