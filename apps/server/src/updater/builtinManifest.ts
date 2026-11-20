/**
 * builtinManifest —— 内置插件清单的读取（发布体系 Task 1）。
 *
 * 清单文件 builtin-manifest.json 由 scripts/gen-builtin-manifest.mjs 在构建时生成，
 * 放在包根（发布后随包分发）。bootstrap 启动时读它：
 * 「这一版后台出厂该带哪些插件、装什么版本」。
 *
 * 为什么是文件不是常量：发布时 server 包不含插件代码，
 * 清单必须能脱离源码独立更新（改内置插件列表 → 重发 server 一版即可）。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface BuiltinManifest {
  /** 插件目录名 → 版本约束（"latest" 或具体 semver） */
  plugins: Record<string, string>
}

/**
 * 读包根的 builtin-manifest.json。
 * 缺失 / 坏 JSON 都返回空清单不抛错 ——
 * 清单读不到只意味着「没有可自动装的内置插件」，不该拦启动。
 */
export async function readBuiltinManifest(pkgRoot: string): Promise<BuiltinManifest> {
  try {
    const raw = await readFile(path.join(pkgRoot, "builtin-manifest.json"), "utf8")
    const parsed = JSON.parse(raw) as Partial<BuiltinManifest>
    return { plugins: parsed.plugins ?? {} }
  } catch {
    return { plugins: {} }
  }
}
