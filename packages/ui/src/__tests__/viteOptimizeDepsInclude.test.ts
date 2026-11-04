/**
 * dev 冷启动「504 Outdated Optimize Dep」的配置守卫。
 *
 * 背景（2026-11-04 实测）：刷新 :5288 时会同时冒出
 *   GET /node_modules/.vite/deps/cn.js?v=<旧hash> net::ERR_ABORTED 504 (Outdated Optimize Dep)
 * 根因是 vite 扫描依赖时不进入 `optimizeDeps.exclude` 里的 workspace 源码包；
 * 这些包用的第三方库只在页面第一次 import 到它们时才被发现，vite 于是重新
 * pre-bundle，浏览器手里的旧 hash 地址当场作废 → 504 + 自动整页刷新。
 *
 * 治法是把这些库写进 `optimizeDeps.include`，让冷启动一次构建齐。浏览器实测：
 * 修复前冷启动日志出现「new dependencies optimized」并自动 reload；修复后一次建完、
 * 刷新网络里没有 504。
 *
 * 本测试守两件事：
 *   ① exclude 里的 workspace 源码包用到的第三方库，都要出现在 include（漏一个就会回退）；
 *   ② 扫描范围只限**实际会冷启动加载**的源码包 —— 插件管理安装的 UMD 外部件不算，
 *      它们的第三方库不该被塞进宿主预构建。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const UI = path.join(REPO, 'packages/ui')

const config = readFileSync(path.join(UI, 'vite.config.ts'), 'utf8')

/** 取 `optimizeDeps: { include: [...], exclude: [...] }` 里两段字符串数组 */
function arrayAfter(marker: RegExp): string[] {
  const m = marker.exec(config)
  if (!m) throw new Error('vite.config.ts 里找不到 ' + marker)
  const open = config.indexOf('[', m.index + m[0].length)
  const close = config.indexOf(']', open)
  const body = config.slice(open + 1, close)
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]!)
}

const include = arrayAfter(/include\s*:/)
const exclude = arrayAfter(/exclude\s*:/)

/** 递归读源码文本（跳过 node_modules / dist / 测试 / demo / 构建配置） */
function sources(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (['node_modules', 'dist', '__tests__', 'e2e', 'demo-web'].includes(name)) continue
    // 构建配置与脚本本身不参与页面运行时（vite / vitest 只在这里出现）
    if (/^(vite|vitest|tsconfig|eslint|tailwind)\.config\.[cm]?[jt]s$/.test(name)) continue
    if (name === 'scripts' || name.endsWith('.test.ts')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx|vue|mts|js|mjs)$/.test(name)) out.push(full)
  }
  return out
}

/** 读包 package.json 的 devDependencies 名（只在那里面的是构建工具，不会被页面加载） */
function devDepsOf(pkgDir: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    return new Set(Object.keys(pkg.devDependencies ?? {}))
  } catch {
    return new Set()
  }
}

/** 从源码里挑出裸模块名（含 `pkg/sub` 与 `@scope/pkg/sub`，统一归到包根） */
function bareImports(text: string): string[] {
  const found: string[] = []
  const patterns = [
    /(?:^|[^\w$.])from\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const spec = m[1]!
      if (/^(\.|\/|@mini-canvas\/|prosemirror-editor-bundle$)/.test(spec)) continue
      if (/^(node:|data:|https?:|blob:)/.test(spec)) continue
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!
      found.push(pkg)
    }
  }
  return found
}

/** 从 workspace 源码包定位它的目录（plugins/<pkg> 或包根） */
function packageDir(dirName: string): string | undefined {
  const candidates = [
    path.join(REPO, 'packages', dirName),
    path.join(REPO, 'packages/plugins', dirName),
  ]
  return candidates.find((p) => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  })
}

/** 源码包名 → 目录名（@mini-canvas/plugin-x → plugin-x，@mini-canvas/foo → foo） */
const dirOf = (pkg: string): string => pkg.replace(/^@mini-canvas\//, '')

/** 合法的 npm 包名（把模板字符串、多行文本、`@/` 别名挡在外面） */
const PKG_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i

/**
 * ui 真正会加载的 workspace 源码包（含间接依赖）。
 *
 * `exclude` 里还有一批是「插件管理」装进来的 UMD 外部件（如 plugin-auto-layout /
 * plugin-canvas-export），ui 源码根本不 import 它们 —— 它们的第三方库由各自产物负责，
 * 不该进 ui 的依赖预构建。只看得到真正编译进 dev 页面的源码包。
 */
function coldStartedPackages(): string[] {
  const seen = new Set<string>()
  const queue: string[] = []
  const push = (spec: string): void => {
    if (spec.startsWith('@mini-canvas/')) queue.push(spec)
    else if (spec === 'prosemirror-editor-bundle') queue.push(spec)
  }
  for (const f of sources(path.join(UI, 'src'))) for (const p of bareImports(readFileSync(f, 'utf8'))) push(p)
  while (queue.length) {
    const pkg = queue.shift()!
    if (seen.has(pkg)) continue
    seen.add(pkg)
    const dirName = pkg === 'prosemirror-editor-bundle' ? pkg : pkg.replace(/^@mini-canvas\//, '')
    const pkgDir = packageDir(dirName)
    if (!pkgDir) continue
    for (const f of sources(path.join(pkgDir, 'src'))) {
      for (const p of bareImports(readFileSync(f, 'utf8'))) push(p)
    }
  }
  return [...seen]
}

describe('vite optimizeDeps 冷启动守卫', () => {
  it('exclude 里的每个源码包，它用的第三方裸模块都要进 include', () => {
    const missing: string[] = []
    const loaded = coldStartedPackages()
    for (const pkg of loaded) {
      if (!exclude.includes(pkg)) continue
      const pkgDir = packageDir(dirOf(pkg))
      if (!pkgDir) continue
      const devDeps = devDepsOf(pkgDir)
      // 只扫**运行时源码目录**（src），配置、脚本、类型声明都不进浏览器
      const roots = new Set(
        bareImports(
          sources(path.join(pkgDir, 'src'))
            .map((f) => readFileSync(f, 'utf8'))
            .join('\n'),
        ),
      )
      for (const dep of roots) {
        // 构建期/测试专用的包不进页面，不用预构建
        if (devDeps.has(dep)) continue
        // 模板字符串 / `@/` 路径别名 / 非包名文本不是真依赖
        if (!PKG_NAME.test(dep) || dep.startsWith('@/')) continue
        // 别的 workspace 源码包不预构建（它们自己会现编）
        if (exclude.includes(dep) || dep.startsWith('@mini-canvas/')) continue
        if (dep === 'prosemirror-editor-bundle') continue
        // ui / cva / @vueuse 这类同名依赖直接写名字；来自别包的用 `包 > 依赖` 精确解析
        const direct = include.includes(dep)
        const scoped = include.some((entry) => entry === pkg + ' > ' + dep)
        if (!direct && !scoped) missing.push(pkg + ' → ' + dep)
      }
    }
    expect([...new Set(missing)], '这些依赖会在 dev 冷启动时触发重新预构建（504）：\n' + missing.join('\n')).toEqual([])
  })

  it('include 里不含 exclude 的源码包本身（源码包要现编，不能被当依赖预构建）', () => {
    for (const pkg of coldStartedPackages()) {
      if (!exclude.includes(pkg)) continue
      expect(include, pkg).not.toContain(pkg)
      expect(include.filter((x) => x === pkg + ' > ' + pkg)).toEqual([])
    }
  })
})
