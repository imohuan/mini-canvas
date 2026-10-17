/***
 * debugDocServer —— 「独立调试页面」的后台半（用户 2026-10-17 定的方案）。
 *
 * 它解决什么：画布内沙箱不可调试（安全设计使然），画布内调试副本拿不到上游实时数据。
 * 这套东西走第三条路：后台直接拼出一份完整独立的 HTML + 数据 JS，落到画布的
 * resources/debug/ 目录 —— Chrome MCP / 任何浏览器自动化可以直接打开那个 URL，
 * 一个普通页面，无沙箱、无 CSP，DevTools / CDP / 断点全通。
 *
 * 三份文件的分工（用户定的：变量、SDK 分开，HTML 只是个壳）：
 *   debug-<nodeId>[-vN].html   壳：主题色板 + <base> + 引两份 JS + 节点原文
 *   context-<nodeId>[-vN].js   数据真相：__CANVAS_INPUTS__ / __CANVAS_UPSTREAM__ / __CANVAS_UI__ 赋值
 *   sdk-<nodeId>[-vN].js       CanvasUI 桥（onChange / setInputs / save）—— 与数据无关，基本不变
 *
 * 数据更新 = 重跑构建工具重写 context.js；窗口里的轮询段发现它变了就重新赋值并触发
 * onChange 回调。HTML 与 sdk.js 在两次构建间不变（除非节点界面本身改了）。
 *
 * 写入为什么直落文件而不是走 CanvasResourceStore：那个 store 的白名单故意不收
 * .html/.js（同源托管下放行等于开 XSS 面），且名字形态（内容哈希 / slot-）也不合适。
 * 调试文件走独立子目录 + 独立白名单：文件名由本模块生成（不接受任意上传），
 * 读取路由只认这个目录这一层。
 */
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { canvasResourcesDir, resolveDebugFile, type UpstreamItemLike } from './canvasPathsShared.js'

/** 画布资源根（<数据根>/canvases/<id>/resources）—— 数据根从 canvasStore.dataRoot() 拿 */
export function debugDirOf(canvasStore: { dataRoot?(): string }, canvasId: string): string {
  const root = typeof canvasStore?.dataRoot === 'function' ? canvasStore.dataRoot() : ''
  if (!root) throw new Error('拿不到数据根目录（canvasStore.dataRoot）')
  return path.join(canvasResourcesDir(root, canvasId), 'debug')
}

/** 节点 id 白名单：与画布 id 同口径（字母数字下划线连字符） */
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 版本号白名单：v 开头 + 字母数字（v1 / v2-beta 都行），可整个不传 */
const VERSION_RE = /^v[A-Za-z0-9_-]{0,63}$/

/** 文件名三件套（不含目录）。非法输入在上游就该被拒；这里再挡一道。 */
export function debugFileNames(nodeId: string, version?: string): { html: string; context: string; sdk: string } {
  if (!NODE_ID_RE.test(nodeId)) throw new Error('非法节点 id: ' + nodeId)
  if (version && !VERSION_RE.test(version)) throw new Error('非法版本号（v 开头 + 字母数字）：' + version)
  const v = version ? '-' + version : ''
  return {
    html: 'debug-' + nodeId + v + '.html',
    context: 'context-' + nodeId + v + '.js',
    sdk: 'sdk-' + nodeId + v + '.js',
  }
}

/**
 * 上游素材规整（与前端 uiData.normalizeUpstream 同一套规则，测试盯着一致）：
 * 按 kind 各自计序号（图片1 / 图片2 / 文本1 …），refName 兜底；
 * 既没 url 又没 value 的空素材直接丢；形状不对的条目跳过（不猜）。
 */
const CN_KIND: Record<string, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }
export function normalizeUpstreamShared(raw: unknown): UpstreamItemLike[] {
  if (!Array.isArray(raw)) return []
  const out: UpstreamItemLike[] = []
  const seq: Record<string, number> = {}
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const kind = typeof rec.kind === 'string' && rec.kind ? rec.kind : 'other'
    const url = typeof rec.url === 'string' && rec.url ? rec.url : undefined
    const value = typeof rec.value === 'string' && rec.value ? rec.value : undefined
    if (!url && !value) continue
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : ''
    const nodeId = typeof rec.id === 'string' && rec.id ? rec.id : undefined
    seq[kind] = (seq[kind] ?? 0) + 1
    const refName = name || (CN_KIND[kind] ?? kind) + seq[kind]
    out.push({
      refName,
      kind,
      ...(url ? { url } : {}),
      ...(value ? { value } : {}),
      ...(nodeId ? { nodeId } : {}),
    })
  }
  return out
}

/**
 * 把值编成能安全进 JS 文件的字面量（与前端 serializeForScript 同一套转义；
 * 保持逐字节一致，测试才锁得住两边行为相同）。
 */
export function serializeForScriptShared(value: unknown): string {
  let json: string
  try {
    json = JSON.stringify(value) ?? 'null'
  } catch {
    return 'null'
  }
  return json
    .split('<').join('\\u003c')
    .split(String.fromCharCode(8232)).join('\\u2028')
    .split(String.fromCharCode(8233)).join('\\u2029')
}

/** context.js 正文：数据真相的唯一载体（几行赋值 + 头注释） */
export function buildContextJs(input: {
  inputs: Record<string, unknown>
  upstream: readonly UpstreamItemLike[]
  ui: Record<string, unknown>
  contextUrl: string
}): string {
  const Q = String.fromCharCode(39)
  const W = (name: string, val: string): string =>
    'window[' + Q + name + Q + '] = ' + val + ';'
  return [
    '/* 由 mini-canvas 自动生成 —— 数据真相文件，改动会被下次构建覆盖。 */',
    '/* 界面通过 sdk-*.js 的轮询发现本文件变化并触发 CanvasUI.onChange。 */',
    W('__CANVAS_INPUTS__', serializeForScriptShared(input.inputs)),
    W('__CANVAS_UPSTREAM__', serializeForScriptShared(input.upstream)),
    W('__CANVAS_UI__', serializeForScriptShared(input.ui)),
    W('__CANVAS_CONTEXT_URL__', serializeForScriptShared(input.contextUrl)),
    '',
  ].join('\n')
}

/** 调试文件的 MIME（读取路由用；白名单只可能有这两种） */
export function debugMime(fileName: string): string {
  return fileName.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8'
}

/** 写一份调试文件（原子覆盖：临时文件 + rename，与 CanvasResourceStore 同款做法） */
export async function writeDebugFile(
  canvasStore: { dataRoot?(): string },
  canvasId: string,
  fileName: string,
  content: string,
): Promise<void> {
  const abs = resolveDebugFile(typeof canvasStore?.dataRoot === 'function' ? canvasStore.dataRoot() : '', canvasId, fileName)
  if (!abs) throw new Error('非法调试文件名: ' + fileName)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const tmp = abs + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, abs).catch(async () => {
    // Windows 上目标被占用时重试一次（renameWithRetry 同款思路，这里依赖少就简写）
    await new Promise((r) => setTimeout(r, 120))
    await fs.rename(tmp, abs)
  })
}

/** 读一份调试文件（读取路由用）；不存在 / 不合法 → undefined */
export async function readDebugFile(
  canvasStore: { dataRoot?(): string },
  canvasId: string,
  fileName: string,
): Promise<string | undefined> {
  const abs = resolveDebugFile(typeof canvasStore?.dataRoot === 'function' ? canvasStore.dataRoot() : '', canvasId, fileName)
  if (!abs) return undefined
  try {
    return await fs.readFile(abs, 'utf8')
  } catch {
    return undefined
  }
}

/** 一次构建的完整结果（MCP 工具返回值的来源） */
export interface DebugDocResult {
  canvasId: string
  nodeId: string
  version?: string
  files: { html: string; context: string; sdk: string }
  urls: { html: string; context: string; sdk: string }
  paths: { html: string; context: string; sdk: string }
  /** 本次数据快照的摘要（Agent 看一眼就知道拼进去的是什么） */
  summary: { upstreamCount: number; inputKeys: string[] }
}

/**
 * 组装 HTML 壳正文（不改节点数据 —— html / sdk 两次构建间不变，context 才是数据）。
 * 产物无 CSP（调试副本口径，与 uiDebug.ts 文件头同款理由）。
 */
export function buildDebugHtml(input: {
  html: string
  theme: 'light' | 'dark'
  baseUrl: string
  sdkFileUrl: string
  contextFileUrl: string
}): string {
  let baseHref = ''
  try {
    const u = new URL(input.baseUrl)
    baseHref = u.origin + (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/')
  } catch {
    baseHref = ''
  }
  const head = [
    '<meta charset="utf-8">',
    ...(baseHref ? ['<base href="' + baseHref + '">'] : []),
    // 主题色白名单: 独立调试页是脱离画布的普通文档，读不到宿主 CSS 变量，与 SHELL_STYLE 同一套理由
    '<style>html, body { margin: 0; padding: 0; width: 100%; height: 100%; } * { box-sizing: border-box; } body { font: 13px/1.5 system-ui, sans-serif; } html[data-theme=\'dark\'] body { background: #16181d; color: #d1d5db; } html[data-theme=\'light\'] body { background: #f9fafb; color: #374151; }</style>',
    '<script src="' + input.sdkFileUrl + '"></script>',
    '<script src="' + input.contextFileUrl + '"></script>',
  ]
  const body = input.html.trim()
  const injectAt = (re: RegExp, fallback: () => string): string => {
    const m = re.exec(body)
    if (m && m.index !== undefined) {
      const at = m.index + m[0].length
      return body.slice(0, at) + head.join('') + body.slice(at)
    }
    return fallback()
  }
  if (/<html[\s>]/i.test(body)) {
    const headIn = /<head[^>]*>/i.exec(body) ? injectAt(/<head[^>]*>/i, () => body) : injectAt(/<html[^>]*>/i, () => head.join('') + body)
    return headIn
  }
  return '<!DOCTYPE html><html data-theme="' + input.theme + '"><head>' + head.join('') + '</head><body>' + body + '</body></html>'
}
