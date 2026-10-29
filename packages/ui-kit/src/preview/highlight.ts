import type { HighlighterCore } from 'shiki/core'

/**
 * 预览区代码高亮：只在用户切到「代码」时加载。
 *
 * 语法引擎和 Vue 语法都动态 import，首屏不下载；
 * 文档里的固定代码由 Vite 构建期生成，不受这里影响。
 */
let highlighter: Promise<HighlighterCore> | undefined

function loadHighlighter(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('@shikijs/langs/vue'),
    import('@shikijs/themes/github-dark-default'),
  ]).then(([core, engine, vue, theme]) => core.createHighlighterCore({
    themes: [theme.default],
    langs: [vue.default],
    engine: engine.createJavaScriptRegexEngine(),
  }))
  return highlighter
}

export async function highlightCode(code: string, lang = 'vue'): Promise<string> {
  const shiki = await loadHighlighter()
  return shiki.codeToHtml(code.replace(/\n$/, ''), {
    lang,
    theme: 'github-dark-default',
  })
}
