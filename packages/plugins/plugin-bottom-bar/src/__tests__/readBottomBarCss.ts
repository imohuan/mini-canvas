/**
 * 读底栏的全部样式（按入口的加载顺序拼接）。
 *
 * 底栏样式从一个大文件拆成多个同目录 CSS 后，源码契约测试不能只看其中一个分片；
 * 这里按 NodeBottomBar.vue 的 import 顺序拼回来，断言与选择器保持原样。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PARTS = [
  'bottom-bar-layout.css',
  'bottom-bar-cards.css',
  'bottom-bar-tagmenu.css',
  'bottom-bar-editor-footer.css',
  'bottom-bar-preview.css',
]

export function readBottomBarCss(): string {
  return PARTS.map((name) =>
    readFileSync(fileURLToPath(new URL('../node-bottom-bar/' + name, import.meta.url)), 'utf8'),
  ).join('\n')
}
