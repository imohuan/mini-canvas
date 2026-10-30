import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import vue from '@shikijs/langs/vue'
import typescript from '@shikijs/langs/typescript'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import css from '@shikijs/langs/css'
import html from '@shikijs/langs/html'
import bash from '@shikijs/langs/bash'
import markdown from '@shikijs/langs/markdown'
import githubDark from '@shikijs/themes/github-dark-default'
import githubLight from '@shikijs/themes/github-light-default'

/**
 * ui-kit 独立 Vite 服务 / 主应用共用的文档插件。
 *
 * 把 src/components/<id>/docs.md 里的 @@VUE@@ 示例变成真正的 Vue 组件。
 *
 * 浏览器里不引入 Vue 模板编译器，也不 eval 文档内容；示例作为 .vue 虚拟模块
 * 交给 @vitejs/plugin-vue，开发服务器和正式构建走同一条路径。
 */
const VUE_EXAMPLE = /@@VUE@@\r?\n([\s\S]*?)@@ENDVUE@@/g
/** 两种代码块按出现顺序编号；Markdown 解析器用同一规则，保证高亮 HTML 对得上。 */
const ANY_CODE = /@@VUE@@\r?\n([\s\S]*?)@@ENDVUE@@|```([\w-]*)\r?\n([\s\S]*?)```/g
const VIRTUAL_PREFIX = 'virtual:ui-kit-doc/'
const EXAMPLE_PREFIX = 'virtual:ui-kit-doc-example/'
const RESOLVED_DOC = '\0' + VIRTUAL_PREFIX
/** 不用 \0：Vue 的 SFC 插件只认磁盘上的 .vue 路径，\0 虚拟路径会被跳过。 */
const RESOLVED_EXAMPLE = EXAMPLE_PREFIX

function examplesOf(source: string): string[] {
  return [...source.matchAll(VUE_EXAMPLE)].map((match) => match[1] ?? '')
}

/** 文档里所有代码块（示例和普通 fenced block），顺序与页面上的块顺序一致。 */
function codeBlocksOf(source: string): Array<{ lang: string; code: string }> {
  return [...source.matchAll(ANY_CODE)].map((match) => match[1] !== undefined
    ? { lang: 'vue', code: match[1] }
    : { lang: (match[2] || 'text').toLowerCase(), code: match[3] ?? '' })
}

const CODE_LANGS: Record<string, string> = {
  vue: 'vue',
  typescript: 'typescript',
  ts: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  markdown: 'markdown',
  md: 'markdown',
  text: 'text',
}

let highlighterPromise: Promise<HighlighterCore> | undefined

function highlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark, githubLight],
    langs: [vue, typescript, javascript, json, css, html, bash, markdown],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}

/**
 * 把代码转成真正高亮的 HTML。
 *
 * 高亮只在 Vite 构建期做，浏览器拿到的是普通 span 和 CSS；
 * 文档里的代码不会被当作页面脚本执行。
 */
export async function highlight(code: string, lang: string): Promise<string> {
  const shiki = await highlighter()
  const known = CODE_LANGS[lang] ?? 'text'
  return shiki.codeToHtml(code.replace(/\n$/, ''), {
    lang: known,
    /**
     * 双主题：同一个代码块同时产出浅色 / 深色两套 token 颜色，
     * 由 CSS 按 Provider 的 data-ui-kit-dark 切换。只输出单套会在另一主题下变成
     * 「浅底浅字」，文档区看起来像坏了。
     */
    themes: { light: 'github-light-default', dark: 'github-dark-default' },
    defaultColor: false,
    transformers: [],
  })
}

/**
 * 读取组件目录里的 docs.md。
 *
 * 文档和组件同目录：src/components/<id>/docs.md；provider 在 src/provider/docs.md。
 * 找不到就返回 undefined，页面会显示「文档还没写」。
 */
function docFile(componentsDir: string, name: string): string | undefined {
  const candidates = [
    path.join(componentsDir, name, 'docs.md'),
    path.join(path.dirname(componentsDir), name, 'docs.md'),
  ]
  return candidates.find((file) => fs.existsSync(file))
}

/**
 * 读文档 + 编译示例。
 *
 * 按文件 mtime 缓存：改 md 后下一次请求一定会拿到新内容，
 * 没改就复用上一次的编译结果，不用每次重新高亮整篇文档。
 */
interface CompiledDoc {
  mtimeMs: number
  markdown: string
  codeHtml: string[]
}

const compiledDocs = new Map<string, CompiledDoc>()

async function compileDoc(file: string): Promise<CompiledDoc> {
  const stat = fs.statSync(file)
  const cached = compiledDocs.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached
  const markdown = fs.readFileSync(file, 'utf8')
  const codeHtml = await Promise.all(
    codeBlocksOf(markdown).map((block) => highlight(block.code, block.lang)),
  )
  const next: CompiledDoc = { mtimeMs: stat.mtimeMs, markdown, codeHtml }
  compiledDocs.set(file, next)
  return next
}

export function uiKitDocsPlugin(componentsDir: string): Plugin {
  return {
    name: 'ui-kit-docs',
    resolveId(id, importer) {
      // 只在 import 语句里解析；load 返回的示例源码必须先经过 Vue 的 SFC 插件，
      // 若这里把 '@mini-canvas/ui-kit' 当成虚拟 id 抢先返回，会把真实组件导入解析坏。
      if (!importer) return undefined
      if (id.startsWith(VIRTUAL_PREFIX)) return RESOLVED_DOC + id.slice(VIRTUAL_PREFIX.length)
      if (id.startsWith(EXAMPLE_PREFIX)) {
        return RESOLVED_EXAMPLE + id.slice(EXAMPLE_PREFIX.length) + '.vue'
      }
      return undefined
    },
    async load(id) {
      if (id.startsWith(RESOLVED_DOC)) {
        const name = id.slice(RESOLVED_DOC.length)
        const file = docFile(componentsDir, name)
        if (!file) return undefined
        const compiled = await compileDoc(file)
        const modules = examplesOf(compiled.markdown).map((_, index) =>
          "import Example" + index + " from '" + EXAMPLE_PREFIX + name + "/" + index + "'",
        ).join('\n')
        const entries = examplesOf(compiled.markdown).map((_, index) => 'Example' + index)
        return modules
          + '\nexport const markdown = ' + JSON.stringify(compiled.markdown) + '\n'
          + 'export const codeHtml = ' + JSON.stringify(compiled.codeHtml) + '\n'
          + 'export default [' + entries.join(', ') + ']\n'
      }
      if (id.startsWith(RESOLVED_EXAMPLE)) {
        // 用 .vue 后缀让 @vitejs/plugin-vue 认领后续 transform；
        // 虚拟模块本身不带扩展名时，Vite 会先把 SFC 当普通 JS 解析而报错。
        const rest = id.slice(RESOLVED_EXAMPLE.length).replace(/\.vue$/, '')
        const slash = rest.lastIndexOf('/')
        if (slash < 0) return undefined
        const name = rest.slice(0, slash)
        const index = Number(rest.slice(slash + 1))
        const file = docFile(componentsDir, name)
        if (!file || !Number.isInteger(index)) return undefined
        const compiled = await compileDoc(file)
        const examples = examplesOf(compiled.markdown)
        if (!examples[index]) return undefined
        // 返回完整 SFC 源码，交给本页的 @vitejs/plugin-vue 继续编译。
        // 这样 TS 脚本、HMR 和源映射都走 Vite 现有管线。
        const code = examples[index]
        return code
      }
      return undefined
    },
    handleHotUpdate(ctx) {
      if (!ctx.file.startsWith(componentsDir) || !ctx.file.endsWith('.md')) return
      /**
       * Vite 8 的 moduleGraph 上没有 `moduleMap`（那是 Vite 5 之前的字段名）。
       * 用旧写法会在改文档时抛 `Cannot read properties of undefined (reading 'values')`，
       * dev server 报错、页面不更新（构建与首屏不受影响，所以很容易被漏掉）。
       * 按 id 找模块用官方保留的 `idToModuleMap`。
       */
      for (const mod of ctx.server.moduleGraph.idToModuleMap.values()) {
        if (mod.id?.startsWith(RESOLVED_DOC) || mod.id?.startsWith(RESOLVED_EXAMPLE)) {
          ctx.server.moduleGraph.invalidateModule(mod)
        }
      }
    },
  }
}
