/**
 * publish —— 从 UI 触发「发布一个库到 registry」（自验证链路）。
 *
 * 背景：发布体系完成后需要一条端到端验证链——
 * UI 点「发布」→ server 打 tgz → 推到 registry（PLUME_REGISTRY 可指本地假 registry）→
 * 更新检查立刻能查到新版本。
 *
 * 安全边界：
 * - 只允许发布 BUILTIN_PLUGINS 清单里的目录 + ui + server（防任意路径打包）;
 * - 与其它写操作一样走 adminAuth 令牌（挂载层统一管）;
 * - registry 必须显式配置 PLUME_REGISTRY 才开（没配 = 只允许 dry-run，防误发真 npm）。
 */
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BUILTIN_BY_DIR } from '../plugins/builtinPlugins.js'

const run = promisify(execFile)
// 路径推导在 bundle 单文件（dist/cli.js）下不可靠（dirname 是 dist 不是 dist/routes），
// 所以优先 PLUME_REPO_ROOT 环境变量；缺省按 dev 结构（src/routes 的上两级 = apps/server）推导。
const SERVER_PKG_ROOT = process.env.PLUME_REPO_ROOT
  ? path.resolve(process.env.PLUME_REPO_ROOT, "apps/server")
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const REPO_ROOT = path.resolve(SERVER_PKG_ROOT, "../..")

export interface PublishRoutesOptions {
  /** 发布目标 registry；未配置时所有请求都回 400（防误发真 npmjs） */
  registry?: string
}

/** 允许发布的白名单：自带插件目录 + ui + server */
function resolveTarget(dir: string): { pkgDir: string; name: string } | { error: string } {
  if (dir === "ui") return { pkgDir: path.join(REPO_ROOT, "apps/web"), name: "@plume-canvas/web" }
  if (dir === "server") return { pkgDir: SERVER_PKG_ROOT, name: "@plume-canvas/server" }
  if (BUILTIN_BY_DIR.has(dir)) {
    return { pkgDir: path.join(REPO_ROOT, "packages/plugins", dir), name: "@plume-canvas/" + dir }
  }
  return { error: "不在发布白名单里（只允许自带插件 / ui / server）：" + dir }
}

export function createPublishRoutes(opts: PublishRoutesOptions): Hono {
  const app = new Hono()
  const registry = opts.registry

  /**
   * 把插件 dist 产物统一成 web.js / server.js 并回填 plume.entry（与构建管道 plugin-assets.mjs 同规则）。
   * 仓库内 vite 产物名是 dist/<pkg>.js；发布包必须与安装器约定一致（dist/web.js）。
   * 返回是否发现后台半（影响回填 server.entry）。
   */
  async function normalizeDist(pkgDir: string, dirName: string): Promise<boolean> {
    const dist = path.join(pkgDir, 'dist')
    let hasServer = false
    try {
      const files = await fs.readdir(dist)
      // 前端半：优先已有 web.js；否则找 <pkg>.js 改名
      if (!files.includes('web.js')) {
        const cand = files.find((f) => f === dirName + '.js')
        if (cand) await fs.rename(path.join(dist, cand), path.join(dist, 'web.js'))
      }
      // 后台半：源码 package.json 声明了 plume.server.entry → dist 里找对应产物改名 server.js；
      // 没声明但有 dist/server.js 也认。
      const srcPkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')) as {
        plume?: { web?: { entry?: string }; server?: { entry?: string } }
      }
      const declaredServer = srcPkg.plume?.server?.entry
      /**
       * 后台入口 = 前端入口时不认（用户 2026-11-25 实测的启动报错）：
       * 底部状态栏 / 快捷键这两个纯前端插件一度把前端产物写成 server.entry，
       * 发布时若照声明改名，会把 web.js 改成 server.js —— 前端半直接没了。
       */
      const frontEntry = path.basename(srcPkg.plume?.web?.entry ?? 'web.js')
      const serverIsFront = !!declaredServer && path.basename(declaredServer) === frontEntry
      if (files.includes('server.js')) {
        hasServer = true
      } else if (declaredServer && !serverIsFront) {
        const serverFile = path.basename(declaredServer)
        if (files.includes(serverFile)) {
          await fs.rename(path.join(dist, serverFile), path.join(dist, 'server.js'))
          hasServer = true
        }
      }
      // 声明指向前端产物 → 连声明一起清掉（否则下次启动又会把它当后台半加载）
      if (serverIsFront && !hasServer) {
        const pkgPath0 = path.join(pkgDir, 'package.json')
        const pkg0 = JSON.parse(await fs.readFile(pkgPath0, 'utf8')) as { plume?: Record<string, unknown> }
        if (pkg0.plume) delete pkg0.plume.server
        await fs.writeFile(pkgPath0, JSON.stringify(pkg0, null, 2) + '\n', 'utf8')
      }
      // 回填 plume entry（发布形态）
      const pkgPath = path.join(pkgDir, 'package.json')
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as { plume?: Record<string, unknown> }
      pkg.plume = {
        ...(pkg.plume ?? {}),
        web: { ...((pkg.plume?.web as object) ?? {}), entry: 'dist/web.js' },
        ...(hasServer ? { server: { ...((pkg.plume?.server as object) ?? {}), entry: 'dist/server.js' } } : {}),
      }
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    } catch { /* dist 不存在等，交给后续 npm pack 报错 */ }
    return hasServer
  }

  app.post("/api/publish", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dir?: string; dryRun?: boolean }
    const dir = typeof body.dir === "string" ? body.dir : ""
    if (!dir) return c.json({ ok: false, error: "需要 dir（插件目录名 / ui / server）" }, 400)
    const target = resolveTarget(dir)
    if ("error" in target) return c.json({ ok: false, error: target.error }, 400)
    if (!registry && !body.dryRun) {
      return c.json({ ok: false, error: "服务端未配置 PLUME_REGISTRY，拒绝发布（只允许 dry-run）" }, 400)
    }

    // 确保有产物：dry-run 也走 npm pack（不推），同时能列出包内容
    if (BUILTIN_BY_DIR.has(dir)) await normalizeDist(target.pkgDir, dir)
    const tmp = path.join(target.pkgDir, ".publish-tmp-" + Date.now())
    try {
      await fs.mkdir(tmp, { recursive: true })
      const args = ["pack", "--pack-destination", tmp]
      const { stdout } = await run("npm", args, { cwd: target.pkgDir, shell: true })
      // 输出最后一行是 tgz 文件名
      const tgzName = stdout.trim().split(/\r?\n/).pop() ?? ""
      const tgzPath = path.join(tmp, tgzName)
      if (body.dryRun) {
        return c.json({ ok: true, dryRun: true, pkg: target.name, tarball: tgzName })
      }
      // 真发：npm publish <tgz> --registry <PLUME_REGISTRY>
      // 非官方 registry（本地假 registry / 私有源）注入 dummy token：npm publish 强制要 auth，
      // 假 registry 不校验 token 内容。官方 npmjs 走用户自己的 .npmrc（不注入）。
      const isLocalRegistry = !registry!.includes("registry.npmjs.org")
      const authArgs = isLocalRegistry ? ["--//" + new URL(registry!).host + "/:_authToken=plume-local-test"] : []
      const pub = await run("npm", ["publish", tgzPath, "--registry", registry!, "--access", "public", ...authArgs], {
        cwd: target.pkgDir,
        shell: true,
        env: { ...process.env },
      })
      return c.json({ ok: true, pkg: target.name, note: pub.stdout.trim().split(/\r?\n/).slice(-2).join(" | ") })
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      return c.json({ ok: false, error: e.stderr ?? e.message ?? String(err) }, 502)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  })

  return app
}
