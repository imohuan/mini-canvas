/**
 * Tailwind 入口里的 `@source` 必须指向真实存在的目录。
 *
 * 为什么需要：Tailwind v4 只扫描 `@source` 指到的源码。目录一改名、路径没跟着改，
 * 扫描就是空跑 —— 组件里的 `bg-primary` / `text-muted-foreground` / `border-input`
 * 这类类名**一个都不会生成**。页面上只剩布局骨架：框还在，但颜色、边框、圆角、
 * 内边距全丢（2026-11-13 用户实测：设置面板与底栏样式整体缺失）。
 *
 * 这里逐条解析入口 CSS 的 `@source`，要求路径存在且目录里确实有源码文件。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '../..')
const REPO_ROOT = path.resolve(WEB_ROOT, '../..')

/** 需要检查的样式入口（相对仓库根） */
const ENTRIES = ['apps/web/src/app.css', 'packages/libs/ui-kit/src/styles/host.css']

function countSources(dir: string): number {
  let n = 0
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) n += countSources(full)
    else if (/\.(ts|tsx|vue|js|mjs)$/.test(name)) n += 1
  }
  return n
}

describe('Tailwind @source 路径', () => {
  for (const entry of ENTRIES) {
    it(`${entry} 的每条 @source 都指向真实源码目录`, () => {
      const file = path.join(REPO_ROOT, entry)
      // 先去掉注释：文档里举例写的路径不该被当成真实指令。
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const sources = [...css.matchAll(/@source\s+["']([^"']+)["']/g)].map((m) => m[1]!)
      expect(sources.length, '没找到 @source，说明入口被改坏了').toBeGreaterThan(0)
      for (const src of sources) {
        const abs = path.resolve(path.dirname(file), src)
        expect(existsSync(abs), `${entry} 里的 @source "${src}" 解析成 ${abs}，目录不存在`).toBe(true)
        expect(countSources(abs), `${src} 里没有任何源码文件`).toBeGreaterThan(0)
      }
    })
  }
})
