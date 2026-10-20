/**
 * 管理令牌覆盖守卫。
 *
 * ## 为什么需要这条
 *
 * 后台从 2026-10-20 起给「能改画布 / 能花额度 / 能装东西」的写接口加了令牌。
 * 保护是**按路径前缀**做的，而调用方散在 ui、各个插件、还有脚本里 ——
 * 漏一处的表现是「某个功能点下去就 403」，而且报错常常只说「请求失败」。
 *
 * 真实踩到的三次：复制画布（projectsApi 裸 fetch）、导出节点包（nodePack 裸 fetch）、
 * showcase 测试台（整段没令牌）。都是这里能提前抓到的。
 *
 * ## 怎么判
 *
 * 扫源码（不扫测试 / 构建产物 / 文档），找同时满足这两个条件的行：
 *   1. 出现受保护前缀（清单直接从 adminAuth.ts 读出来，不在这里抄一份）；
 *   2. 这一行是**请求调用**（fetch / doFetch / json / request）。
 * 然后要求：要么同一行带令牌，要么同文件里有一处统一的令牌出口。
 *
 * 第二条允许「统一出口」：像 agentApi 的 request、cloud-client 的 doFetch、
 * projectsApi 的 req 都是把令牌加在一个私有函数里，调用点看起来是裸的 —— 那是对的，
 * 不能逼着每个调用点都写一遍头（那才是最容易漏的形态）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const uiPkg = resolve(here, '../..') // packages/ui
const packagesDir = resolve(uiPkg, '..') // packages
const repoRoot = resolve(packagesDir, '..')

/** 受保护前缀直接从后台那份清单读 —— 两边各写一份迟早漂 */
function protectedPrefixes(): string[] {
  const src = readFileSync(join(packagesDir, 'cloud-server/src/adminAuth.ts'), 'utf8')
  const block = /ADMIN_WRITE_PREFIXES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src)
  const postOnly = /ADMIN_POST_ONLY_PREFIXES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(src)
  const grab = (text: string | undefined): string[] =>
    [...(text ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  return [...grab(block?.[1]), ...grab(postOnly?.[1])]
}

/** 递归收集源码（跳过测试 / 构建产物 / node_modules） */
function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collect(p, out)
    else if (/\.(ts|vue|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

/**
 * 找「包装函数」：定义体里真的调用了 withAdminToken 的那些函数名。
 *
 * 为什么不能只看名字：`showcaseHeaders` 若被改成 `return extra`（不带令牌），
 * 调用点看起来仍然像有包装，守卫就失效了。所以包装必须**可追溯到**真正的
 * withAdminToken 调用 —— 定义后 12 行内出现它才算数（包装函数都很短）。
 */
function wrapperNamesOf(src: string): string[] {
  const lines = src.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    // 允许泛型：`async function req<T>(` —— 漏掉 `<T>` 会让所有泛型出口函数认不出来
    const m = /(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/.exec(lines[i]!)
    if (!m) continue
    const body = lines.slice(i, i + 12).join('\n')
    if (/withAdminToken\s*\(/.test(body)) out.push(m[1]!)
  }
  return out
}

/** 这一行是不是真的把令牌放进了请求头（不含注释、不含纯 import） */
function isAuthUseLine(line: string): boolean {
  if (/^\s*(\*|\/\/)/.test(line)) return false
  if (/^\s*import\b/.test(line)) return false
  return /withAdminToken\s*\(|ADMIN_TOKEN_HEADER\]?\s*[=,)]|['"]x-admin-token['"]\s*:|['"]x-task-token['"]\s*:/.test(line)
}

describe('管理令牌覆盖：受保护路径的调用都带令牌', () => {
  it('★ 没有漏带令牌的请求调用点', () => {
    const prefixes = protectedPrefixes()
    // 清单读不出来就说明 adminAuth.ts 改了形状 —— 这条守卫本身要更新
    expect(prefixes.length).toBeGreaterThan(15)

    const roots = [join(uiPkg, 'src'), join(packagesDir, 'plugins')]
    const files = roots.flatMap((r) => collect(r))
    // 全仓扫一遍「包装函数名」：定义体里真的调用了 withAdminToken 的才算
    const allWrappers = [...new Set(files.flatMap((f) => wrapperNamesOf(readFileSync(f, 'utf8'))))]

    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const lines = src.split(/\r?\n/)
      // 包装函数可能定义在别的文件（showcaseHeaders 在 apiBase.ts）——
      // 所以把「所有源码里能追溯到 withAdminToken 的函数名」都算进来。
      const wrappers = allWrappers
      /** 这个行号落在哪个函数的定义体里（往上找最近的一个 function 声明） */
      const ownerOf = (at: number): { start: number; end: number } => {
        let start = 0
        for (let k = at; k >= 0; k--) {
          if (/^\s*(export\s+)?(async\s+)?function\s+[A-Za-z0-9_$]+\s*(?:<[^>]*>)?\s*\(/.test(lines[k]!)) { start = k; break }
        }
        return { start, end: lines.length }
      }
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (/^\s*(\*|\/\/)/.test(line)) continue // 注释里提到路径不算
        const hit = prefixes.find((p) => line.includes(p))
        if (!hit) continue
        // 只关心「真的发请求」的行
        if (!/\b(fetch|doFetch|this\.json|this\.request|req)\s*\(/.test(line)) continue
        // 看**整个调用块**（fetch(...) 的 headers 通常写在后面几行），不只这一行
        const block = lines.slice(i, i + 8).join('\n')
        // 只管**写方法**：GET/HEAD 不需要令牌（后台也只拦写）
        const m = /method:\s*['"]([A-Z]+)['"]/.exec(block)
        const method = (m?.[1] ?? 'GET').toUpperCase()
        if (method === 'GET' || method === 'HEAD') continue
        // ① 同一块里直接把令牌写进头；② 调用了可追溯的包装函数 —— 直接算覆盖
        if (block.split('\n').some((l) => isAuthUseLine(l))) continue
        if (wrappers.some((w) => new RegExp('\\b' + w + '\\s*\\(').test(block))) continue
        // ③ 所在函数体里有令牌（统一出口那种：函数里只写一次，所有调用都受益）
        const fn = ownerOf(i)
        const fnBody = lines.slice(fn.start, fn.end).join('\n')
        if (isAuthUseLine(fnBody)) continue
        const rel = file.replace(repoRoot, '').replace(/\\/g, '/')
        offenders.push(rel + ':' + (i + 1) + '  ' + line.trim())
      }
    }

    expect(
      offenders,
      '这些请求打的是受保护前缀，但所在文件没有统一加令牌：\n' + offenders.join('\n'),
    ).toEqual([])
  })
})

