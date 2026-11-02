/**
 * 组件库使用标记：给「模板里用到 shadcn 组件」的标签加定位属性。
 *
 * 值来自 Vue 编译器的模板节点位置（原文件 + 行号 + 列号），所以气泡显示的是真实使用点。
 *
 * **构建版也要有**（2026-11-02 用户反馈）：以前只挂在 dev server 上，
 * 于是打开 cloud-server 托管的构建版时，设置里那个开关永远没有效果。
 * 现在 dev 与 build 都注入；属性只是两个字符串，代价可忽略，
 * 调试层本身仍由开关控制（关着就不挂载、不监听）。
 */
import { parse } from 'vue/compiler-sfc'
// Vite 加载插件配置时走 Node 的 ESM 解析（不做扩展名补全），所以这里要带 .ts。
import { UI_KIT_DEBUG_ATTR, UI_KIT_DEBUG_COMPONENT_ATTR } from './debugLoc.ts'
import { isShadcnPrimitive } from './shadcnFamilies.ts'

interface VitePluginLike {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: null } | null
}

/** 模板元素节点（只用到 walk 需要的几个字段） */
interface ElementLike {
  type: number
  tag?: string
  children?: ElementLike[]
  loc: { start: { line: number; column: number; offset: number } }
}

/** dev 与 build 都挂载（构建版打开开关后同样能看到标记） */
export function uiKitDebugLocPlugin(options: { root: string }): VitePluginLike {
  return {
    name: 'mini-canvas:ui-kit-debug-loc',
    enforce: 'pre',
    transform(code, id) {
      const file = id.replace(/\\/g, '/').split('?')[0] ?? ''
      // 组件库自身的 .vue 已经被 vue 插件编译过；只给业务使用点加属性。
      if (file.includes('/packages/ui-kit-shadcn/')) return null
      if (!file.endsWith('.vue') || file.includes('/node_modules/')) return null
      const next = injectUiKitDebugLoc(code, file, options.root)
      return next === code ? null : { code: next, map: null }
    },
  }
}

/** 给一个 SFC 源码里的 shadcn 使用点加定位属性；没有改动时原样返回 */
export function injectUiKitDebugLoc(code: string, filename: string, root: string): string {
  const { descriptor, errors } = parse(code, { filename })
  if (errors.length || !descriptor.template?.ast) return code
  const imports = uiKitImports(
    descriptor.script?.content ?? '',
    descriptor.scriptSetup?.content ?? '',
  )
  if (!imports.size) return code

  const tags: Array<{
    local: string
    component: string
    line: number
    column: number
    offset: number
  }> = []
  walk(descriptor.template.ast as unknown as ElementLike, (node) => {
    if (node.type !== 1 || !node.tag) return
    const component = imports.get(node.tag)
    if (!component) return
    tags.push({
      local: node.tag,
      component,
      line: node.loc.start.line,
      column: node.loc.start.column,
      offset: node.loc.start.offset,
    })
  })
  if (!tags.length) return code

  // 从后往前插，前面的 offset 不会失效。属性插在标签名之后。
  const edits = tags.sort((a, b) => b.offset - a.offset)
  let out = code
  for (const item of edits) {
    const open = out.indexOf('<', item.offset)
    if (open < 0) continue
    let nameEnd = open + 1
    if (out[nameEnd] === '/') nameEnd++
    while (nameEnd < out.length && /[\w:.-]/.test(out[nameEnd] ?? '')) nameEnd++
    if (out.slice(open + 1, nameEnd).replace(/^\//, '') !== item.local) continue
    const loc = `${relative(root, filename)}:${item.line}:${item.column}`
    const attr = ` ${UI_KIT_DEBUG_ATTR}="${escapeAttr(loc)}" ${UI_KIT_DEBUG_COMPONENT_ATTR}="${escapeAttr(item.component)}"`
    out = out.slice(0, nameEnd) + attr + out.slice(nameEnd)
  }
  return out
}

/** 本地组件名 → 组件库里导出的名字（支持多行 import 与 `Button as UiButton`） */
function uiKitImports(script: string, setup: string): Map<string, string> {
  const out = new Map<string, string>()
  const pattern = /(?:from\s+)?['"]@mini-canvas\/ui-kit-shadcn['"]/g
  for (const source of [script, setup]) {
    for (const match of source.matchAll(pattern)) {
      // 从模块名回到最近的 import 关键字；中间不能再出现别的 import。
      const before = source.slice(0, match.index)
      const start = before.lastIndexOf('import ')
      if (start < 0) continue
      const clause = before.slice(start + 'import '.length)
      if (/import\s/.test(clause)) continue
      const named = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? ''
      for (const part of named.split(',')) {
        const clean = part.replace(/^type\s+/, '').trim()
        if (!clean) continue
        const [exported, local] = clean.split(/\s+as\s+/)
      // 只认 shadcn 生成的原始组件：SettingsRow / SettingsSection 这类
      // 本项目在组件库里补的布局件不算，标了也会被用户当成噪音（2026-11-02 反馈）。
      if (!exported || !isShadcnPrimitive(exported.trim())) continue
      if (local) out.set(local.trim(), exported.trim())
      else out.set(exported.trim(), exported.trim())
      }
    }
  }
  return out
}

function walk(node: ElementLike, cb: (node: ElementLike) => void): void {
  cb(node)
  for (const child of node.children ?? []) {
    if (typeof child !== 'string') walk(child, cb)
  }
}

function relative(root: string, filename: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  const full = filename.replace(/\\/g, '/')
  return full.startsWith(base + '/') ? full.slice(base.length + 1) : full
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
