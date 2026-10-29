import type { Component } from 'vue'

/**
 * 文档入口：Vite 插件负责读 Markdown 并把 vue 示例编译成组件。
 * 这里补一个具名的类型出口，页面不用依赖 .md 子路径（包里不公开 docs 目录）。
 */
import examples, { codeHtml, markdown } from 'virtual:ui-kit-doc/button'
import splitPaneExamples, { codeHtml as splitPaneCodeHtml, markdown as splitPaneMarkdown } from 'virtual:ui-kit-doc/split-pane'

export const buttonDocs = {
  markdown: markdown as string,
  examples: examples as Component[],
  codeHtml: codeHtml as string[],
}

export const splitPaneDocs = {
  markdown: splitPaneMarkdown as string,
  examples: splitPaneExamples as Component[],
  codeHtml: splitPaneCodeHtml as string[],
}
