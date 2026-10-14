/**
 * pack —— 把「一个可视化节点 + 它依赖的脚本」打成包（纯逻辑 + 读文件）。
 *
 * 包里四份（见 docs/plan/node-package-plan.md 第二节）：
 *   manifest.json    包格式版本、包名、导出时间、每个脚本的 sha256
 *   node.json        节点本体（type / size / data，含依赖声明 uiScripts）
 *   ui.html          界面代码（就是 data.uiHtml）
 *   scripts/<名>.mjs  **只带这个节点用到的**脚本，不是整个目录
 *
 * 三条不变量：
 * 1. **只带声明的**：带多了会把别人写的脚本一起打包走（那是别的节点依赖的东西）；
 * 2. **声明里列了但机器上没有** → 不静默跳过，如实写进 manifest.missing（打包的人要知道）；
 * 3. **不带媒体素材**（第一版，用户 2026-10-13 拍板）：节点的图/视频是画布资源地址，
 *    换台机器就失效；要连字节一起带是后面单独一轮的事。
 */
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildZip, readZip, type ZipEntry } from './zip.js'
import { resolveScriptPath } from './scripts.js'
import { declaredNames } from './authorize.js'

/** 包格式版本（读的时候按它判断兼容性） */
export const PACK_FORMAT = 1

/**
 * 包的后缀（**唯一来源**）。
 *
 * 三处要用到它：后台打包时拼文件名、cloud-server 的 mime 白名单（决定存进资产库后
 * 有没有后缀）、前端拼下载与预填的文件名。各写一份的话漂了不会报错 ——
 * 只会表现成"拖进去没反应"（2026-10-13 审查指出三处各写了一份）。
 * 前端那份在 packages/ui（跨包 import 会把 node 侧逻辑拖进浏览器包），
 * 所以那边留一个同名常量，并由一条测试盯着两边一致。
 */
export const PACK_EXT = '.mcnode'

/**
 * 解开之后的**总字节**上限。
 *
 * 为什么要有它：输入大小（见 importRoutes 的 MAX_PACK_BYTES）挡不住"解压炸弹"——
 * 压缩比可以几十上百倍，一个看起来很小的包能解出几个 GB。
 * 32MB 对"脚本 + 界面代码"来说已经极宽（正常包几十 KB）。
 */
export const MAX_UNPACKED_BYTES = 32 * 1024 * 1024

/** 节点 manifest 里的形状 */
export interface PackManifest {
  format: number
  /** 包名（默认取节点标题；收藏时可被上传弹窗里的名字覆盖） */
  name: string
  /** 导出时间 */
  at: number
  /** 节点类型（现在只有 'ui'，留着给以后的类型） */
  nodeType: string
  /** 包里带的脚本：名字 → 内容摘要 */
  scripts: Record<string, { sha256: string; bytes: number }>
  /** 声明里列了、但这台机器上没有的脚本名（**如实写出来**，不静默吞） */
  missing: string[]
}

/** 从包里读出来的东西 */
export interface UnpackedPack {
  manifest: PackManifest
  /** 节点本体（原样，供导入时还原） */
  node: Record<string, unknown>
  html: string
  /** 包里的脚本：名字 → 源码文本 */
  scripts: Record<string, string>
  /** 包里的额外文件（现在没有，留着给"以后要带素材"那一版） */
  extra: ZipEntry[]
}

/** 节点最小形状（本模块只关心这几个字段） */
export interface PackNodeLike {
  id: string
  type: string
  position?: { x: number; y: number }
  size?: { w: number; h: number }
  data?: Record<string, unknown>
}

/**
 * 打一个节点包。
 *
 * @param scriptsDir 机器上的脚本目录
 * @returns ZIP 字节 + manifest（调用方要拿 manifest 做提示/存库）
 */
export async function buildNodePack(
  node: PackNodeLike,
  scriptsDir: string,
  now: number,
): Promise<{ bytes: Uint8Array; manifest: PackManifest }> {
  const data = node.data ?? {}
  const html = typeof data.uiHtml === 'string' ? data.uiHtml : ''
  const declared = declaredNames(data)

  const files: ZipEntry[] = []
  const scripts: PackManifest['scripts'] = {}
  const missing: string[] = []

  for (const name of declared) {
    const abs = resolveScriptPath(scriptsDir, name)
    let text: string | undefined
    if (abs) {
      try {
        text = await fs.readFile(abs, 'utf8')
      } catch {
        text = undefined
      }
    }
    if (text === undefined) {
      // 声明里有、机器上没有：如实记下来。打包的人（或 AI）该知道这个包是不完整的。
      missing.push(name)
      continue
    }
    const bytes = new TextEncoder().encode(text)
    scripts[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
    files.push({ name: 'scripts/' + name + '.mjs', data: bytes })
  }

  const manifest: PackManifest = {
    format: PACK_FORMAT,
    name: typeof data.label === 'string' && data.label ? data.label : node.id,
    at: now,
    nodeType: node.type,
    scripts,
    missing,
  }

  // node.json：**原样带过去**（不含运行期字段），导入那侧按它还原
  const nodeJson = {
    id: node.id,
    type: node.type,
    ...(node.position ? { position: node.position } : {}),
    ...(node.size ? { size: node.size } : {}),
    data,
  }

  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { name: 'node.json', data: new TextEncoder().encode(JSON.stringify(nodeJson, null, 2)) },
    { name: 'ui.html', data: new TextEncoder().encode(html) },
    ...files,
  ]
  return { bytes: buildZip(entries, new Date(now)), manifest }
}

/** 从字节里读出一个包（形状不对就报错，不猜） */
export function readNodePack(bytes: Uint8Array): UnpackedPack {
  let entries: ZipEntry[]
  try {
    entries = readZip(bytes, MAX_UNPACKED_BYTES)
  } catch (err) {
    throw new Error('这不像是一个节点包：' + (err instanceof Error ? err.message : String(err)))
  }
  const dec = (b: Uint8Array) => new TextDecoder().decode(b)
  const get = (name: string): string | undefined => {
    const e = entries.find((x) => x.name === name)
    return e ? dec(e.data) : undefined
  }

  const manifestText = get('manifest.json')
  const nodeText = get('node.json')
  if (!manifestText || !nodeText) throw new Error('包不完整：缺少 manifest.json 或 node.json')

  let manifest: PackManifest
  let node: Record<string, unknown>
  try {
    manifest = JSON.parse(manifestText) as PackManifest
    node = JSON.parse(nodeText) as Record<string, unknown>
  } catch (err) {
    throw new Error('包里的 JSON 读不出来：' + (err instanceof Error ? err.message : String(err)))
  }
  if (typeof manifest.format !== 'number' || manifest.format > PACK_FORMAT) {
    throw new Error('包的格式版本不认识（这个包是更新版的应用导出的）：' + String(manifest.format))
  }

  const scripts: Record<string, string> = {}
  for (const e of entries) {
    const m = /^scripts\/([A-Za-z0-9_-]{1,64})\.mjs$/.exec(e.name)
    if (m) scripts[m[1]!] = dec(e.data)
  }

  const known = new Set(['manifest.json', 'node.json', 'ui.html', ...Object.keys(scripts).map((n) => 'scripts/' + n + '.mjs')])
  return {
    manifest,
    node,
    html: get('ui.html') ?? '',
    scripts,
    extra: entries.filter((e) => !known.has(e.name)),
  }
}

