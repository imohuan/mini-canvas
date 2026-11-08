/**
 * 独立目验页专用的 shiki 空实现（Vite 插件）。
 *
 * 只在 dev 服务器里生效：颜色配方界面不涉及代码高亮，但 ui-kit 的 code-block
 * 会 import shiki；这个可选重依赖没装时会让整页 Vite 报错，连颜色配方都打不开。
 */
const ID = 'virtual:shiki-stub'
const RESOLVED = '\0' + ID

export function shikiStubPlugin() {
  return {
    name: 'shiki-stub',
    resolveId(id: string) {
      return id === ID ? RESOLVED : null
    },
    load(id: string) {
      if (id !== RESOLVED) return null
      return [
        'export const createHighlighterCore = async () => ({',
        '  codeToHtml: (code) => "<pre>" + code + "</pre>",',
        '  getLoadedLanguages: () => [],',
        '})',
        'export const createOnigurumaEngine = () => ({})',
        'export const createHighlighter = createHighlighterCore',
        'export default {}',
      ].join('\n')
    },
  }
}
