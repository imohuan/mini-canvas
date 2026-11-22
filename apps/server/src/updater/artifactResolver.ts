/**
 * artifactResolver —— 按声明路径找包产物，找不到时在 dist 下兜底（bootstrap 与 npmPlugins 共用）。
 *
 * 为什么要兜底：线上早期发布的包 entry 写 dist/web.js，实际文件是 dist/<包名>.js。严格按
 * entry 找会让这类包永远装不上（实测 24 个内置插件全失败）。这里与 bootstrap 启动安装
 * 同一条语义：entry 命中直接用；未命中 → dist 下唯一非 .map 的 .js 直接用；多个候选时
 * 按名字精确匹配（rel 里包含文件名，如 dist/web.js 与 web.js）挑一个；都没有才报错。
 */
import { access as fsAccess, readdir } from 'node:fs/promises'
import path from 'node:path'

export async function resolveArtifact(
  extracted: string,
  rel: string,
  /** server 半解析时排除 web.js 这类明显的另一半产物（bootstrap 同款参数） */
  fallbackExclude?: string,
): Promise<string> {
  try {
    await fsAccess(path.join(extracted, rel))
    return rel
  } catch {
    /* 走兜底 */
  }
  const distDir = path.join(extracted, 'dist')
  let files: string[] = []
  try {
    files = await readdir(distDir)
  } catch {
    throw new Error('包里没有产物：' + rel)
  }
  const candidates = files.filter(
    (f) => f.endsWith('.js') && !f.endsWith('.map') && f !== fallbackExclude,
  )
  // 优先 server.js（后台半）与名字相近的；只有唯一候选时直接用
  if (candidates.length === 1) return 'dist/' + candidates[0]
  const exactName = candidates.find((f) => rel.includes(f))
  if (exactName) return 'dist/' + exactName
  throw new Error(
    '包里缺少声明的产物：' + rel + '（dist 下候选：' + candidates.join(', ') + '）',
  )
}
