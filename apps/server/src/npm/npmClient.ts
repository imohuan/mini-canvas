/**
 * npmClient —— NPM registry 只读客户端（计划 Task 3；零新依赖：Node 内置 fetch）。
 *
 * 三个动作：
 * 1. packument：查一个包的全部版本元数据（含 dist-tags.latest 与每个版本的 tarball 地址）；
 * 2. 搜索：走 registry 的官方搜索端点 /-/v1/search（GET 只读、无鉴权）；
 * 3. 下载 tarball：流式落盘 tgz。
 *
 * 解包用系统 tar（Win10+/Linux/macOS 自带；Node 无内置 tar）。
 * 超时与错误信息都写明语义，路由层据此回 4xx/5xx。
 */

import path from 'node:path'

/** registry 基址（默认 npmjs；测试注入本地假 registry） */
export interface NpmClientOptions {
  registry?: string
  /** fetch 替身（测试注入） */
  fetchImpl?: typeof fetch
  /** 下载超时 ms（默认 30s） */
  timeoutMs?: number
}

export interface NpmVersionInfo {
  version: string
  tarball: string
  /** 该版本 package.json 里的 plume 段（没有则 undefined） */
  plume?: Record<string, unknown>
  /** 该版本的发布时间（packument 的 time 段） */
  publishedAt?: string
}

export interface NpmPackument {
  name: string
  'dist-tags': { latest?: string }
  versions: Record<string, NpmVersionInfo>
  time: Record<string, string>
  description?: string
}

/** npm 搜索结果的一条（已裁剪到本系统关心的字段） */
export interface NpmSearchHit {
  name: string
  description: string
  version: string
  date: string
  links: { npm?: string }
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

export function createNpmClient(opts: NpmClientOptions = {}) {
  const registry = (opts.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 30_000

  /** 带超时的 fetch */
  async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await doFetch(url, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 取一个包的完整元数据；404 = 包不存在（调用方转 404），其他非 2xx 抛错 */
  async function packument(name: string): Promise<NpmPackument> {
    const res = await timedFetch(registry + '/' + encodeURIComponent(name))
    if (res.status === 404) throw new NpmNotFoundError(name)
    if (!res.ok) throw new Error('npm registry 返回 ' + res.status + '（查 ' + name + '）')
    return (await res.json()) as NpmPackument
  }

  /**
   * 搜索。q 会做转义；scope 过滤由**路由层**做（它还要按 plume.installable
   * 二次过滤 —— 那需要对每个命中再查一次 packument，属于路由的编排职责）。
   */
  async function search(q: string, size = 20): Promise<NpmSearchHit[]> {
    const url = registry + '/-/v1/search?text=' + encodeURIComponent(q) + '&size=' + size
    const res = await timedFetch(url)
    if (!res.ok) throw new Error('npm 搜索返回 ' + res.status)
    const body = (await res.json()) as {
      objects: Array<{ package: { name: string; description?: string; version: string; date?: string; links?: { npm?: string } } }>
    }
    return body.objects.map((o) => ({
      name: o.package.name,
      description: o.package.description ?? '',
      version: o.package.version,
      date: o.package.date ?? '',
      links: o.package.links ?? {},
    }))
  }

  /** 下载 tarball 到指定文件（tgz 原样落盘） */
  async function downloadTarball(tarballUrl: string, destFile: string): Promise<void> {
    // 用 node:http 而不是 fetch：vitest 环境里全局 fetch 的连接池与本地 http server 的
    // 短生命周期端口有 keep-alive 竞态（实测 ECONNREFUSED，同 URL fetch 探针却成功）。
    // http.get 每次新建连接，行为可预期。
    // 超时与重定向：registry 可能 302 到 CDN，网络挂起不能永久卡住安装请求。
    const buf = await new Promise<Buffer>((resolve, reject) => {
      void (async () => {
        const { get } = await import('node:http')
        const { get: getHttps } = await import('node:https')
        let remaining = 5
        let url = tarballUrl
        const attempt = (): void => {
          const getter = url.startsWith('https:') ? getHttps : get
          const req = getter(url, (res) => {
            // 跟随重定向（registry → CDN 常见 302/307），防跳转环最多 5 跳
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume()
              if (remaining-- <= 0) {
                reject(new Error('下载 tarball 失败：重定向超过 5 次（' + tarballUrl + '）'))
                return
              }
              url = new URL(res.headers.location, url).toString()
              attempt()
              return
            }
            if (res.statusCode !== 200) {
              reject(new Error('下载 tarball 失败：HTTP ' + res.statusCode + '（' + tarballUrl + '）'))
              res.resume()
              return
            }
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks)))
          })
          req.on('error', reject)
          // 连接/响应挂起兜底：destroy 会触发 error → reject，不会悬着
          req.setTimeout(timeoutMs, () => req.destroy(new Error('下载 tarball 超时（' + timeoutMs + 'ms）：' + tarballUrl)))
        }
        attempt()
      })()
    })
    const fs = await import('node:fs')
    await fs.promises.writeFile(destFile, buf)
  }

  return { registry, packument, search, downloadTarball }
}

/** 包不存在的专用错误（路由层转 404） */
export class NpmNotFoundError extends Error {
  constructor(name: string) {
    super('npm 上找不到包：' + name)
    this.name = 'NpmNotFoundError'
  }
}

/**
 * 解包 tgz 到目录（系统 tar；-x 略过属主信息，Windows 与 Unix 行为一致）。
 * npm tarball 的顶层目录是 package/ —— strip 后把内容摊平到 destDir。
 */
export async function extractTarball(tgzFile: string, destDir: string): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdir } = await import('node:fs/promises')
  const run = promisify(execFile)
  await mkdir(destDir, { recursive: true })
  // 先列目录再解包：拒绝绝对路径与 ../ 穿越（恶意 tarball 覆盖任意文件的经典路径）
  const listing = await run('tar', ['-tzf', tgzFile])
  for (const entry of listing.stdout.split(/\r?\n/)) {
    const name = entry.trim()
    if (!name) continue
    const stripped = name.replace(/^package\//, '')
    if (path.isAbsolute(stripped) || stripped.split('/').includes('..')) {
      throw new Error('tarball 含非法路径条目（拒绝解包）：' + name)
    }
  }
  // GNU tar 与 bsdtar（Windows 自带）都支持 -xzf 与 --strip-components
  await run('tar', ['-xzf', tgzFile, '-C', destDir, '--strip-components=1'])
  return path.join(destDir, 'package.json')
}
