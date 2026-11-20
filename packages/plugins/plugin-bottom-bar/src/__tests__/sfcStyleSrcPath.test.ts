/**
 * 组件里的 `<style src>` 只能用能“跟着组件走”的写法（2026-11-20 真踩）。
 *
 * 背景：BottomBarModelPicker 复用进设置页时，我曾加过
 * `<style src="./bottom-bar-model-trigger.css">`。相对路径由解析器按**宿主目录**定位，
 * 在 apps/web dev server 下变成 `apps/web/bottom-bar-model-trigger.css` →
 * ENOTENT、整页白屏。插件会被不同宿主装载，这类路径没有一处是安全的。
 *
 * 规则：插件组件里不要新增 `<style src>`；样式要么内联，要么从 .ts 里 import。
 * 已有的 `bottom-bar-model-menu.css` 是历史入口，保留但不再增加第二处。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...vueFiles(full))
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

describe('插件组件的 style src 路径', () => {
  it('只允许已有的三处，不再新增（新增会按宿主目录解析，直接白屏）', () => {
    const hits: string[] = []
    for (const file of vueFiles(SRC)) {
      const code = readFileSync(file, 'utf8')
      for (const m of code.matchAll(/<style[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)) {
        hits.push(file.slice(SRC.length).replace(/\\/g, '/') + ' -> ' + m[1].replace(/\\/g, '/'))
      }
    }
    // 这三处是历史上已有的（同一个目录、同一条已跑通的解析链路）。
    // 新增任何一处 —— 尤其是多引入一个新 css 文件 —— 都会踩到本次的 ENOTENT。
    expect(hits.sort()).toEqual([
      'node-bottom-bar/BottomBarModelPicker.vue -> ./bottom-bar-model-menu.css',
      'node-bottom-bar/BottomBarPresets.vue -> ./prompt-presets.css',
      'node-bottom-bar/ChoicePickerMenu.vue -> ./bottom-bar-choice-menu.css',
    ])
  })
})
