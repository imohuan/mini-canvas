/**
 * resolve —— 「把一个资源地址翻成本地文件路径」的纯逻辑（零 IO，可单测）。
 *
 * ## 为什么要有它
 *
 * 脚本从界面拿到的是**同源地址**（如 `/api/canvases/default/resources/8f3a….mp4`），
 * 而 ffmpeg 这类命令读**本地文件**最快（走 http 也能读，但慢、还多依赖一层后台）。
 * 于是每次都要脚本自己把地址"翻译"成磁盘路径 —— 这套翻译规则是**后台的内部知识**
 * （数据根在哪、canvases/resources 怎么摆），让每个脚本各推一遍既费劲又容易推错
 * （用户的 video-grid.mjs 就为此写了一大段推导 + 内容哈希落盘）。
 *
 * 所以收进 ctx：**脚本给地址，宿主给路径**。
 *
 * ## 认哪几种写法
 *
 *   1. 画布资源    /api/canvases/<画布>/resources/<名字>       → <根>/canvases/<画布>/resources/<名字>
 *   2. 上传资产    /api/assets/files/<名字>                    → <根>/assets/files/<名字>
 *   3. 绝对地址    http://host/api/…（先剥掉 origin，再按 1/2 认）
 *   4. 相对/裸名   `a.mp4` / `out/x.png` → 依次在 workspace / dir / 数据根 下找得到就用
 *
 * **找不到就返回 undefined**（而不是编一个路径）—— 调用方据此回落到"直接把地址交给命令"，
 * 或自己决定怎么办；编一个不存在的路径只会让 ffmpeg 报一句看不懂的错。
 */
import path from 'node:path'
import { existsSync } from 'node:fs'

/** 解析需要知道的几个位置（都从宿主那边传进来，纯函数不自己去猜） */
export interface ResolveEnv {
  /** 数据根目录（`<根>/canvases`、`<根>/assets` 的上一级） */
  dataRoot?: string
  /** 本次调用的工作目录 */
  workspace?: string
  /** 脚本自己所在的目录 */
  dir?: string
}

/** 画布资源地址里那一段 */
const CANVAS_MARKER = '/api/canvases/'
/** 上传资产地址里那一段 */
const ASSET_MARKER = '/api/assets/files/'

/** 资源名安全判据：单段、不含分隔符（与后端 canvasResources / assetStore 同一套口径） */
const CANVAS_RES_NAME_RE = /^(?:[0-9a-f]{16}(?:\.[a-z0-9]+)?|slot-[A-Za-z0-9_-]{1,64}(?:\.[a-z0-9]+)?)$/i
const ASSET_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/

/** 剥掉 query / hash / origin，只留路径部分 */
function pathOf(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return ''
  // 去掉 ?query 与 #hash（产物地址常带 ?v=时间戳 —— 那部分是给浏览器刷缓存用的，与文件无关）
  s = s.split('#')[0]!.split('?')[0]!
  // 剥 origin（http://host:port/xxx → /xxx）
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = new URL(s).pathname
  } catch {
    /* 不是合法 URL 就按原样处理 */
  }
  return s
}

/**
 * 尝试把地址翻成本地路径。
 * @returns 存在且是文件的绝对路径；认不出 / 不存在 → undefined
 */
export function resolveLocalFile(raw: string, env: ResolveEnv): string | undefined {
  const p = pathOf(raw)
  if (!p) return undefined

  // ① 画布资源（含槽位）：/api/canvases/<画布>/resources/<名字>
  const atCanvas = p.indexOf(CANVAS_MARKER)
  if (atCanvas >= 0 && env.dataRoot) {
    const rest = p.slice(atCanvas + CANVAS_MARKER.length).split('/')
    // <画布>/resources/<名字>
    if (rest.length >= 3 && rest[1] === 'resources') {
      const canvasId = rest[0]!
      const name = rest[2]!
      if (/^[A-Za-z0-9_-]{1,64}$/.test(canvasId) && CANVAS_RES_NAME_RE.test(name)) {
        const abs = path.join(env.dataRoot, 'canvases', canvasId, 'resources', name)
        if (existsSync(abs)) return abs
      }
    }
  }

  // ② 上传资产：/api/assets/files/<名字>
  const atAsset = p.indexOf(ASSET_MARKER)
  if (atAsset >= 0 && env.dataRoot) {
    const name = p.slice(atAsset + ASSET_MARKER.length)
    if (ASSET_NAME_RE.test(name)) {
      const abs = path.join(env.dataRoot, 'assets', 'files', name)
      if (existsSync(abs)) return abs
    }
  }

  // ③ 相对路径 / 裸文件名：依次在 workspace → dir → 数据根 下找
  const rel = p.replace(/^\/+/, '')
  if (!rel.includes('..')) {
    for (const base of [env.workspace, env.dir, env.dataRoot]) {
      if (!base) continue
      const abs = path.resolve(base, rel)
      // 防越界：解析结果必须还在这个 base 里面
      if (!abs.startsWith(path.resolve(base) + path.sep)) continue
      if (existsSync(abs)) return abs
    }
  }
  return undefined
}

