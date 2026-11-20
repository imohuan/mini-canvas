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
const SERVER_PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const REPO_ROOT = path.resolve(SERVER_PKG_ROOT, "../..")

export interface PublishRoutesOptions {
  /** 发布目标 registry；未配置时所有请求都回 400（防误发真 npmjs） */
  registry?: string
}

/** 允许发布的白名单：自带插件目录 + ui + server */
function resolveTarget(dir: string): { pkgDir: string; name: string } | { error: string } {
  if (dir === "ui") return { pkgDir: path.join(REPO_ROOT, "apps/web"), name: "@plume-canvas/ui" }
  if (dir === "server") return { pkgDir: SERVER_PKG_ROOT, name: "@plume-canvas/cloud-server" }
  if (BUILTIN_BY_DIR.has(dir)) {
    return { pkgDir: path.join(REPO_ROOT, "packages/plugins", dir), name: "@plume-canvas/" + dir }
  }
  return { error: "不在发布白名单里（只允许自带插件 / ui / server）：" + dir }
}

export function createPublishRoutes(opts: PublishRoutesOptions): Hono {
  const app = new Hono()
  const registry = opts.registry

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
