#!/usr/bin/env node
/**
 * migrate-res-to-url —— 把画布节点里**历史形态**的资源引用 `res:<hashName>` 一次性换成同源 URL。
 *
 * 背景：节点媒体字段（imageUrl / videoUrl / …）与 resourceId 过去存的是画布内相对引用
 * `res:<16位十六进制[.扩展名]>`；写入侧现已统一成
 * `/api/canvases/<canvasId>/resources/<hashName>`（浏览器/下游直接能请求的地址）。
 * 存量画布用本脚本补齐 —— 读老数据的兼容分支仍然保留，但盘上不该再留 `res:`。
 *
 * 用法：
 *   node scripts/migrate-res-to-url.mjs [--dir <数据根>] [--dry-run] [--help]
 *
 *   --dir <数据根>   数据根目录（其下有 canvases/<画布id>/canvas.json）。
 *                    缺省 = 本包目录下的 .mini-canvas（不依赖当前工作目录）。
 *   --dry-run        只打印将要做的改动，一个字节都不写（也不生成备份）。
 *
 * 行为：
 *   - 只转「`res:` 开头且名字是 16 位十六进制 + 可选扩展名」的值；其它值（外部地址、
 *     /api/assets/... 资产地址、已转换过的 URL、`res:` 但名字不合法）**逐字原样**保留。
 *   - 写盘前把原文件另存为同目录的 `canvas.json.bak-<时间戳>`；**绝不覆盖已存在的备份**
 *     （同名就加序号），所以反复跑不会丢任何一版原件。
 *   - 落盘走「写临时文件 + rename」，中途失败不会留下半截 JSON。
 *   - 写完后自动再扫一遍复查：还剩几个可转换的 `res:`。还有残留 → 退出码 1。
 *
 * 退出码：0 = 成功（含「本就没有可转的」与「目录不存在」）；1 = 复查有残留 / 参数或目录读不了。
 * 单行注释里出现星号斜杠没问题；本文件只有这一处块注释，别在里面写 `*` + `/` 连着的写法。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 引用前缀（与 src/store/canvasResources.ts 的 RESOURCE_REF_PREFIX 一致；只为读老数据） */
export const RESOURCE_REF_PREFIX = 'res:'

/** 要处理的节点字段：九个媒体地址 + resourceId（与 canvas-data 的 RESOURCE_URL_FIELDS 对齐） */
export const MEDIA_FIELDS = [
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'posterUrl',
  'thumbUrl',
  'maskUrl',
  'panoUrl',
  'leftImageUrl',
  'rightImageUrl',
]
export const RESOURCE_FIELDS = [...MEDIA_FIELDS, 'resourceId']

/** 资源名白名单：16 位十六进制 + 可选扩展名（与后端 isSafeResourceName 同口径） */
const RESOURCE_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i

/** 数据根缺省值：本包目录下的 .mini-canvas（按脚本自身位置定位，与 cwd 无关） */
export function defaultDataRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url)) // <包>/scripts
  return path.resolve(here, '..', '.mini-canvas')
}

/** `res:<hashName>` → `/api/canvases/<画布id>/resources/<hashName>`（与写入侧同一形态） */
export function toResourceUrl(canvasId, hashName) {
  return '/api/canvases/' + canvasId + '/resources/' + hashName
}

/**
 * 转一个字段值（纯函数）。
 *
 * @returns {{ value: unknown, changed: boolean, action: 'converted' | 'kept' | 'invalid' }}
 *   converted = 换成了 URL；kept = 非 res: 形态（外部地址 / 已是 URL / 其它），原样；
 *   invalid = 是 `res:` 但名字不合法（打错了），原样保留并报出来让人查。
 */
export function convertValue(value, canvasId) {
  if (typeof value !== 'string' || !value.startsWith(RESOURCE_REF_PREFIX)) {
    return { value, changed: false, action: 'kept' }
  }
  const name = value.slice(RESOURCE_REF_PREFIX.length)
  if (!RESOURCE_NAME_RE.test(name)) {
    return { value, changed: false, action: 'invalid' }
  }
  return { value: toResourceUrl(canvasId, name), changed: true, action: 'converted' }
}

/** 深拷贝（不碰调用方传进来的对象） */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** 跳过原因归类（打印用） */
function skippedReason(value) {
  if (typeof value === 'string' && value.startsWith(RESOURCE_REF_PREFIX)) return 'invalid'
  if (typeof value === 'string' && (/^https?:\/\//i.test(value) || value.startsWith('/'))) return 'alreadyUrl'
  return 'other'
}

/**
 * 转一份 canvas.json（纯函数，不落盘）。
 *
 * 字段优先看 `node.data`；节点对象顶层若有同名字符串字段也一并处理（防御性 ——
 * 老数据/手写数据里出现过这种形状）。
 *
 * @returns {{ next: object, converted: number, skipped: { alreadyUrl: number, invalid: number, other: number } }}
 */
export function convertCanvas(canvasJson, canvasId) {
  const next = clone(canvasJson ?? {})
  const skipped = { alreadyUrl: 0, invalid: 0, other: 0 }
  let converted = 0
  const nodes = Array.isArray(next.nodes) ? next.nodes : []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const data = node.data && typeof node.data === 'object' ? node.data : undefined
    for (const field of RESOURCE_FIELDS) {
      const inData = data && typeof data[field] === 'string'
      const onNode = typeof node[field] === 'string'
      if (!inData && !onNode) continue
      const target = inData ? data : node
      const r = convertValue(target[field], canvasId)
      if (r.changed) {
        target[field] = r.value
        converted += 1
      } else if (r.action === 'invalid') {
        skipped.invalid += 1
      } else {
        skipped[skippedReason(target[field])] += 1
      }
    }
  }
  return { next, converted, skipped }
}

/** 扫描一份 canvas.json 里还有几个「可转换的 res:」（复查用，纯函数） */
export function countConvertible(canvasJson, canvasId) {
  const { converted } = convertCanvas(canvasJson, canvasId)
  return converted
}

/** 列出 <数据根>/canvases 下的画布 id（目录名） */
async function listCanvasIds(root) {
  const dir = path.join(root, 'canvases')
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

/** 时间戳（本地时间、可读、文件名安全）：20261008-171500-123 */
function stamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return (
    p(date.getFullYear(), 4) +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    '-' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds()) +
    '-' +
    p(date.getMilliseconds(), 3)
  )
}

/** 备份路径：绝不覆盖已存在的备份（同名就 -2、-3 …往后加） */
async function backupPathFor(file) {
  const base = file + '.bak-' + stamp()
  let candidate = base
  let i = 1
  while (await exists(candidate)) {
    i += 1
    candidate = base + '-' + i
  }
  return candidate
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** 原子写文本：先写唯一临时文件，再 rename 覆盖目标 */
async function atomicWriteText(file, text) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(tmp, text, 'utf8')
  try {
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** 解析命令行参数（不认识的参数明确报错，不静默忽略） */
export function parseArgs(argv) {
  const opts = { dir: undefined, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--dir') {
      const v = argv[i + 1]
      if (!v || v.startsWith('--')) return { error: '--dir 后面要给一个目录路径' }
      opts.dir = v
      i += 1
    } else if (a.startsWith('--dir=')) {
      opts.dir = a.slice('--dir='.length)
      if (!opts.dir) return { error: '--dir= 后面要给一个目录路径' }
    } else return { error: '不认识的参数: ' + a }
  }
  return opts
}

const USAGE = `
用法: node scripts/migrate-res-to-url.mjs [--dir <数据根>] [--dry-run]

  --dir <数据根>   数据根目录（其下有 canvases/<画布id>/canvas.json）
                   缺省 = ${defaultDataRoot()}
  --dry-run        只打印，不写盘、不生成备份
  --help           看这段说明
`

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error('[migrate-res-to-url] ' + opts.error)
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (opts.help) {
    console.log(USAGE)
    return
  }

  const root = path.resolve(opts.dir ?? defaultDataRoot())
  console.log('[migrate-res-to-url] 数据根: ' + root)
  if (opts.dryRun) console.log('[dry-run] 只打印将要做的改动，一个字节都不写')

  if (!(await exists(root))) {
    console.log('数据根不存在（没什么可迁移的）: ' + root)
    return
  }

  const ids = await listCanvasIds(root)
  if (ids.length === 0) console.log('canvases/ 下没有画布（没什么可迁移的）')

  let totalConverted = 0
  let totalSkipped = 0
  let touchedCanvases = 0

  for (const id of ids) {
    const file = path.join(root, 'canvases', id, 'canvas.json')
    if (!(await exists(file))) {
      console.log('画布 ' + id + ': 没有 canvas.json（跳过）')
      continue
    }
    let json
    try {
      json = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (err) {
      console.error('画布 ' + id + ': canvas.json 读不出来 / 不是合法 JSON —— ' + (err && err.message))
      process.exitCode = 1
      continue
    }

    const { next, converted, skipped } = convertCanvas(json, id)
    const skippedTotal = skipped.alreadyUrl + skipped.invalid + skipped.other
    totalConverted += converted
    totalSkipped += skippedTotal
    const head = '画布 ' + id + ': 改了 ' + converted + ' 个字段，跳过 ' + skippedTotal + ' 个'
    const detail =
      '（已是地址/URL ' + skipped.alreadyUrl + '，res: 名字不合法 ' + skipped.invalid + '，其它 ' + skipped.other + '）'

    if (converted === 0) {
      console.log(head + detail + ' —— 无需改动')
      continue
    }
    touchedCanvases += 1
    if (opts.dryRun) {
      console.log(head + detail + ' [dry-run] 未写盘')
      continue
    }

    // 先备份原件（绝不覆盖已有备份），再原子写回
    const original = await fs.readFile(file, 'utf8')
    const bak = await backupPathFor(file)
    await fs.writeFile(bak, original, 'utf8')
    await atomicWriteText(file, JSON.stringify(next))
    console.log(head + detail + ' → 备份 ' + path.basename(bak))
  }

  console.log(
    '总计：画布 ' + ids.length + ' 张（改动 ' + touchedCanvases + ' 张），改 ' + totalConverted + ' 个字段，跳过 ' + totalSkipped + ' 个',
  )

  if (opts.dryRun) {
    // 干跑时"复查"就是预演：数出来的就是**若真跑会改掉的那些**
    console.log('[dry-run] 复查（预演）：剩余可转换的 res: 有 ' + totalConverted + ' 个')
    console.log('[dry-run] 未写盘；去掉 --dry-run 跑一次即可完成转换（并自动复查）')
    return
  }

  // ==================== 写后复查：用同一套逻辑再干跑一遍 ====================
  const leftovers = await scanConvertible(root)
  console.log('复查：剩余可转换的 res: 有 ' + leftovers.total + ' 个')
  for (const l of leftovers.items) console.log('  - 画布 ' + l.canvasId + ' 节点 ' + l.nodeId + ' 字段 ' + l.field)
  if (leftovers.total > 0) {
    console.error('✘ 复查未通过：仍有 res: 未转换（见上），请重跑或人工核对')
    process.exitCode = 1
    return
  }
  console.log('✔ 复查通过：已无 res: 可转换')
}

/** 复查：重读盘上的文件，列出还有哪些字段是可转换的 res:（纯读，不写） */
export async function scanConvertible(root) {
  const items = []
  for (const id of await listCanvasIds(root)) {
    const file = path.join(root, 'canvases', id, 'canvas.json')
    if (!(await exists(file))) continue
    let json
    try {
      json = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      continue // 读不动的文件已在上一步报过，这里不重复吵
    }
    const nodes = Array.isArray(json.nodes) ? json.nodes : []
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const data = node.data && typeof node.data === 'object' ? node.data : undefined
      for (const field of RESOURCE_FIELDS) {
        const value = data && typeof data[field] === 'string' ? data[field] : node[field]
        if (convertValue(value, id).changed) items.push({ canvasId: id, nodeId: node.id ?? '?', field })
      }
    }
  }
  return { total: items.length, items }
}

// 只在「直接运行本文件」时执行主流程：被测试 import 时绝不能去扫盘/写盘
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[migrate-res-to-url] 失败：', err)
    process.exitCode = 1
  })
}
