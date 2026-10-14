import { defineLoader } from 'vitepress'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 「插件解析」索引数据：构建期扫 packages/docs/plugins/parsed 下的每个插件目录。
 *
 * 为什么自动扫：解析页有 30+ 个插件、每个插件一页总览 + 若干子页。
 * 手写清单 = 每加一个插件就要改一次，且必然写漏。扫目录：加一个目录 = 索引自动多一行。
 *
 * 取每个目录 index.md 的 H1 当插件名，并列出它有哪些子页（子页名取各页 H1）。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PARSED_DIR = path.resolve(HERE, '../../plugins/parsed')

export interface ParsedPluginEntry {
  /** 目录名（= /plugins/parsed/<dir> 的 <dir>） */
  dir: string
  /** 插件名（总览页 H1） */
  title: string
  /** 总览页链接 */
  link: string
  /** 子页列表（名字取各页 H1） */
  pages: Array<{ text: string; link: string }>
}

/** 子页展示顺序（表里没有的排最后） */
const ORDER = [
  'service', 'node-type', 'tools', 'theme-slots', 'commands', 'shortcuts',
  'bottom-bar', 'appliers', 'ui-components', 'slots', 'events', 'server', 'config',
]

declare const data: ParsedPluginEntry[]
export { data }

export default defineLoader({
  async load(): Promise<ParsedPluginEntry[]> {
    const out: ParsedPluginEntry[] = []
    let dirs: string[] = []
    try {
      dirs = await fs.readdir(PARSED_DIR)
    } catch {
      return []
    }
    const headingOf = async (file: string): Promise<string> => {
      const raw = await fs.readFile(file, 'utf8').catch(() => '')
      const m = raw.match(/^#\s+(.+)$/m)
      return m ? m[1].replace(/\s*#+\s*$/, '').trim() : ''
    }
    for (const dir of dirs.sort()) {
      const full = path.join(PARSED_DIR, dir)
      const st = await fs.stat(full).catch(() => null)
      if (!st?.isDirectory()) continue
      const indexFile = path.join(full, 'index.md')
      if (!(await fs.stat(indexFile).catch(() => null))) continue
      const base = '/plugins/parsed/' + dir
      const files = (await fs.readdir(full).catch(() => [] as string[])).filter((f) => f.endsWith('.md') && f !== 'index.md')
      files.sort((a, b) => {
        const ka = a.replace(/\.md$/, '')
        const kb = b.replace(/\.md$/, '')
        const ia = ORDER.indexOf(ka)
        const ib = ORDER.indexOf(kb)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || ka.localeCompare(kb)
      })
      const pages: Array<{ text: string; link: string }> = []
      for (const f of files) {
        const key = f.replace(/\.md$/, '')
        pages.push({ text: (await headingOf(path.join(full, f))) || key, link: base + '/' + key })
      }
      out.push({ dir, title: (await headingOf(indexFile)) || dir, link: base + '/', pages })
    }
    return out
  },
})

