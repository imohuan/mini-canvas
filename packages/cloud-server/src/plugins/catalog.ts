/**
 * catalog —— 「插件管理」要的清单：扫插件目录，生成「浏览器能装哪些插件、各自的 js 地址」。
 *
 * 与同目录 pluginRoutes 里那份 /plugin-manifest.json 的**分工**（别混）：
 *
 * | 清单 | 给谁用 | 收录什么 | 加载方式 |
 * | --- | --- | --- | --- |
 * | /plugin-manifest.json | 画布应用自己（ui 的 onReady） | **ESM** 产物（能被 import 进去） | import(data:text/javascript) |
 * | /plugin-catalog.json（本文件） | 「插件管理」插件（用户手动装卸） | **UMD** 产物（能被 script 加载） | script src |
 *
 * 为什么要两套而不是合一：两种产物形态的**加载机制不同**（ESM 靠 import、UMD 靠全局 + script），
 * 判据也不同（UMD 产物里没有顶层 export、但有一个 MiniCanvasPlugin* 全局）。混成一份清单，
 * 加载方必然要猜，猜错就是「列出来了却装不上」。分开之后各管一摊，互不干扰。
 *
 * 收录条件（两条都要满足，宁可少列也不列装不上的）：
 * 1. package.json 显式声明 miniCanvas.installable: true —— 这是「特意留给插件管理安装」的标记。
 *    默认不收录：theme-default / node-image 这类是应用**冷启动就装好**的基础件，
 *    列进来会被插件管理装第二遍 → 撞重名。
 * 2. 插件目录下的 dist/ 里有 .js，且它是**能被 script 直接加载的 UMD 产物**
 *    （判据：产物里有 MiniCanvasPlugin* 全局赋值）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** 清单里的一项 —— 插件管理据此渲染一行、并按 url 去加载 */
export interface PluginCatalogEntry {
  /** 稳定身份（目录名）；插件管理用它做「已装/未装」的键 */
  id: string
  /** 插件在画布里的**真实名字**（源码 export 的 name；可用 package.json 的 miniCanvas.pluginName 声明） */
  name: string
  /** 面板上显示的名字（package.json 的 miniCanvas.title，缺省用 id） */
  title: string
  description?: string
  /** 浏览器可直接请求的地址（**相对本服务**，如 /plugins/<pkg>/<file>） */
  url: string
  /** UMD 产物在 window 上暴露的全局名（加载后从这里取插件对象） */
  globalName: string
  /** 该产物运行时需要哪些 window 全局（Vue / MiniCanvasCore / …）；缺了会加载失败 */
  requiresGlobals: string[]
  /** 是否默认安装（缺省 true） */
  defaultInstalled: boolean
  /**
   * 是否**自带**（随应用冷启动装配、不可从插件管理页装卸）。
   *
   * 为什么要在清单里列出它们：用户要"即使自带的插件也显示出来，但不显示安装/卸载按钮" ——
   * 一个页面能看清"这台画布一共有哪些插件、哪些是我能动的"，比只列可装卸的更完整。
   * 判据取 package.json 的 miniCanvas.builtin（见文件头）。前端据此**只读展示**。
   */
  builtin?: boolean
  /**
   * 后台插件产物（同一个包里若还有 dist/server.js，则这一项有值）。
   *
   * 为什么放在同一条清单项里：用户要的是「一个插件 = 前后端一起装」的体验。
   * 前后端是**同一个发布单元**的两半，用同一个 id 配对，界面上显示成一张卡片、
   * 两个状态灯（前端 ✓ / 后台 ✓）。只有一半的插件也合法（另一半留空）。
   */
  server?: {
    /** 后台产物地址（相对本服务，如 /plugins/<pkg>/server.js） */
    url: string
    /**
     * 后台产物的 sha256（**服务端算的信任源**，不是调用方声明的）。
     * 安装时用它校验完整性；没有它 → 拒绝安装（见 routes/serverPlugins.ts 的说明）。
     */
    sha256?: string
    /** 声明的权限（如 net / store / fs）；目前只记录与展示，不做强制 */
    permissions?: string[]
  }
  version?: string
}

/** 整份清单 */
export interface PluginCatalog {
  ok: true
  /** 内容版本：清单一变就变；前端可据此省掉重复搬运 */
  version: number
  plugins: PluginCatalogEntry[]
  /** 扫到但没收进来的文件及原因（诊断用，不影响使用） */
  skipped: Array<{ file: string; reason: string }>
}

/**
 * 产物运行时可能需要的 window 全局。
 * 单一事实源是 packages/plugins/vite-plugin-lib.ts 的 HOST_GLOBALS（值的集合）；
 * 这边必须与它保持一致 —— sharedGlobals.test.ts 会同时读两边做守卫（漂移即红）。
 */
export const KNOWN_GLOBALS = [
  'Vue',
  'VueFlow',
  'MiniCanvasCore',
  'MiniCanvasKernel',
  'MiniCanvasBase',
  'MiniCanvasRender',
  'ProseMirrorEditorBundle',
] as const

/**
 * 从 UMD 产物文本里读出它的全局名。
 *
 * 打包时 css-injected-by-js 会先插一段很长的 style，真正的 UMD 头被挤到几千字符之后，
 * 所以**不能只看文件开头**；直接全文找那段 e.MiniCanvasPluginXxx={} 。
 */
export function parseUmdGlobalName(text: string): string | undefined {
  return text.match(/\.(MiniCanvasPlugin[A-Za-z0-9_]+)\s*=\s*\{\}/)?.[1]
}

/**
 * 读产物运行时需要的 window 全局名。
 * 只认 UMD 头那段参数列表里的 e.Vue 形态（require 分支里是字符串 'vue'，不算）——
 * 锚定到全局名之后 800 字符内，避免正文里的字符串误命中。
 */
export function parseRequiresGlobals(text: string): string[] {
  const anchor = text.match(/\.MiniCanvasPlugin[A-Za-z0-9_]+\s*=\s*\{\}/)
  if (!anchor || anchor.index === undefined) return []
  const header = text.slice(anchor.index, anchor.index + 800)
  return KNOWN_GLOBALS.filter((g) => new RegExp('[,(]\\s*[a-zA-Z_$][\\w$]*\\.' + g + '\\b').test(header))
}

/** 把清单折成一个 32 位整数版本号（同内容同号，改了内容就变） */
export function catalogVersion(entries: PluginCatalogEntry[]): number {
  const s = entries.map((e) => e.id + '@' + e.url + '#' + (e.version ?? '') + (e.builtin ? '!b' : '')).join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface PkgJson {
  name?: string
  version?: string
  miniCanvas?: {
    title?: string
    description?: string
    defaultInstalled?: boolean
    /** 是否交给插件管理安装（默认 false，见文件头说明） */
    installable?: boolean
    /** 插件在画布里的真实名字（= 源码 export 的 name） */
    pluginName?: string
   /** 是否自带（随应用冷启动、不可装卸）；见 PluginCatalogEntry.builtin */
    /** 后台插件声明的权限（记录 + 展示用，暂不强制） */
    serverPermissions?: string[]
    /** 是否自带（随应用冷启动、不可装卸）；见 PluginCatalogEntry.builtin */
    builtin?: boolean
    /**
     * 自带插件是否**配套一个后台半**（已在 cloud-server 内置跑着）。
     *
     * 为什么要有：自带件（如 Agent）的前端半随应用启动，另一半是后台内置路由 ——
     * 用户希望列表里也能看出"这个自带件有没有后台"。声明 true 时清单给 server 标记。
     */
    serverBuiltin?: boolean
  }
}

async function readPkgJson(dir: string): Promise<PkgJson> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as PkgJson
  } catch {
    return {}
  }
}

/**
 * 扫插件目录，生成插件管理要的清单。
 * 目录不存在 → 空清单（不是错误：可能一个插件都还没构建）。
 */
export async function buildPluginCatalog(pluginsDir: string | undefined): Promise<PluginCatalog> {
  const plugins: PluginCatalogEntry[] = []
  const skipped: Array<{ file: string; reason: string }> = []
  if (!pluginsDir) {
    return { ok: true, version: 0, plugins, skipped: [{ file: '(未配置插件目录)', reason: '服务没有找到 packages/plugins' }] }
  }

  let names: string[]
  try {
    names = await fs.readdir(pluginsDir)
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return { ok: true, version: 0, plugins, skipped: [{ file: pluginsDir, reason: '插件目录不存在' }] }
    }
    throw err
  }

  for (const pkgName of names.sort()) {
    if (pkgName.startsWith('_') || pkgName.startsWith('.')) continue
    const pkgDir = path.join(pluginsDir, pkgName)
    let stat
    try {
      stat = await fs.stat(pkgDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue

    const pkg = await readPkgJson(pkgDir)
    // 收录两类（其余跳过，避免把不相干的目录也列进来）：
    //   · installable: true —— 可经插件管理装卸（默认已装）；
    //   · builtin: true     —— 自带（冷启动装配），**只读展示**、不给安装/卸载。
    const isInstallable = pkg.miniCanvas?.installable === true
    const isBuiltin = pkg.miniCanvas?.builtin === true
    if (!isInstallable && !isBuiltin) {
      skipped.push({ file: pkgName, reason: '未声明 miniCanvas.installable / builtin（不在插件管理里展示）' })
      continue
    }

    const id = pkgName
    const name = pkg.miniCanvas?.pluginName ?? (pkg.name ?? pkgName).replace(/^@[^/]+\//, '')
    const title = pkg.miniCanvas?.title ?? pkgName

    // 自带插件：**只要 package.json 声明了就能列**（不必构建 UMD —— 它由应用冷启动装配，不靠清单加载）。
    if (isBuiltin) {
      plugins.push({
        id,
        name,
        title,
        ...(pkg.miniCanvas?.description ? { description: pkg.miniCanvas.description } : {}),
        url: '', // 自带件不经 URL 加载（前端只读展示，不安装）
        globalName: '',
        requiresGlobals: [],
        defaultInstalled: true,
        builtin: true,
        // 自带件若声明了 serverBuiltin，标一个 server 段（url 空 —— 它是内置路由，不经 URL 装）
        ...(pkg.miniCanvas?.serverBuiltin === true ? { server: { url: '' } } : {}),
        ...(pkg.version ? { version: pkg.version } : {}),
      })
      continue
    }

    // 可装卸插件：必须有**能被 script 直接加载的 UMD 产物**（否则列出来也装不上）。
    const distDir = path.join(pkgDir, 'dist')
    let files: string[]
    try {
      files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))
    } catch {
      skipped.push({ file: pkgName, reason: '没有 dist（先跑 pnpm -C packages/plugins/' + pkgName + ' build）' })
      continue
    }
    const file = files.sort()[0]
    if (!file) {
      skipped.push({ file: pkgName, reason: 'dist 里没有 .js' })
      continue
    }
    let text: string
    try {
      text = await fs.readFile(path.join(distDir, file), 'utf8')
    } catch (err) {
      skipped.push({ file: pkgName, reason: '读产物失败：' + (err as Error).message })
      continue
    }
    const globalName = parseUmdGlobalName(text)
    if (!globalName) {
      skipped.push({ file: pkgName, reason: '不是可脚本加载的 UMD 产物（没有 MiniCanvasPlugin* 全局）' })
      continue
    }
    // 后台产物：同一个包的 dist/server.js（有就是「前后端成对」的插件）。
    // 缺了不报错——很多插件只有前端。
    const serverFile = files.find((f) => f === 'server.js' || f === 'plugin-server.js')
    // 后台产物：算 sha256 作为**服务端信任源**（安装时用它校验，见 serverPlugins 路由）
    let server: PluginCatalogEntry['server']
    if (serverFile) {
      try {
        const serverText = await fs.readFile(path.join(distDir, serverFile), 'utf8')
        server = {
          url: '/plugins/' + pkgName + '/' + serverFile,
          sha256: createHash('sha256').update(serverText, 'utf8').digest('hex'),
          ...(Array.isArray(pkg.miniCanvas?.serverPermissions)
            ? { permissions: pkg.miniCanvas.serverPermissions.filter((p): p is string => typeof p === 'string') }
            : {}),
        }
      } catch {
        // 读不出来就当作"没有后台产物"（远端安装会被 sha 检查拒掉，安全）
        server = undefined
      }
    }
    plugins.push({
      id,
      name,
      title,
      ...(pkg.miniCanvas?.description ? { description: pkg.miniCanvas.description } : {}),
      // 相对地址：与 ui 同源时直接能用；跨源时前端按清单地址的 origin 补全。
      url: '/plugins/' + pkgName + '/' + file,
      globalName,
      requiresGlobals: parseRequiresGlobals(text),
      defaultInstalled: pkg.miniCanvas?.defaultInstalled ?? true,
      ...(server ? { server } : {}),
      ...(pkg.version ? { version: pkg.version } : {}),
    })
  }

  // 按插件运行时名去重：NPM 装进来的前端半（id 形如 scope__name）与仓库里的源码包
  // （id 形如 plugin-name）的 miniCanvas.pluginName 相同（如都是 showcase）。内核按插件名
  // 索引，装一个会顶掉另一个 —— 清单里列两行是**假的重复项**（用户实测：看到两个一样的
  // 插件展示）。这里只保留一份。
  // 保留谁：优先保留 **NPM 装进来的那份**（id 带 scope__ 前缀）。
  // 理由（安全）：管理页的"卸载"会删掉该条对应的目录 —— 若清单指向仓库源码目录，
  // 卸载就把作者的源码删了。指向 NPM 副本则只删副本，源码包原地不动（之后会重新列出来）。
  const deduped: PluginCatalogEntry[] = []
  const seenName = new Map<string, number>()
  for (const p of plugins) {
    const prev = seenName.get(p.name)
    if (prev === undefined) {
      seenName.set(p.name, deduped.length)
      deduped.push(p)
    } else {
      const incumbent = deduped[prev]!
      // 保留"已装副本"的那份：id 含 scope__ 前缀优先；两份同形则保留先来的
      const incumbentIsInstalled = incumbent.id.includes('__')
      const pIsInstalled = p.id.includes('__')
      // 已装副本优先；同形（都不是/都是）保留先来的
      const keepIncumbent = incumbentIsInstalled || !pIsInstalled
      const loser = keepIncumbent ? p : incumbent
      const winner = keepIncumbent ? incumbent : p
      skipped.push({ file: loser.id, reason: '与 ' + winner.id + ' 同为一个插件（运行时名 ' + p.name + '），只列一份' })
      deduped[prev] = winner
    }
  }
  return { ok: true, version: catalogVersion(deduped), plugins: deduped, skipped }
}
