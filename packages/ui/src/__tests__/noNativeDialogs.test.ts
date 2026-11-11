/**
 * 全局红线（用户口径 2026-11-06）：packages 下禁止再用浏览器原生 confirm / alert / prompt。
 *
 * 为什么做成全仓扫描而不是逐组件单测：这类回退往往是「临时加一行 window.confirm」引入的，
 * 逐组件测很难覆盖到新文件；扫一遍源码最直接。测试、注释、backup 与依赖目录跳过。
 *
 * 允许的例外只有两类（都在本文件的 EXCEPTIONS 里点名）：
 * - 反馈服务自己的方法名 confirm / prompt / alert（不是在调浏览器全局）；
 * - 调试窗口测试桩里注入的 alert 回调（纯逻辑接口，不是浏览器全局）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const packagesRoot = path.join(repoRoot, 'packages')
const SOURCE_EXT = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs'])

/** 明确允许出现的文件（相对 packages/ 的路径，统一用 / 分隔） */
const EXCEPTIONS = new Set([
  // 统一服务的定义处：这里的 confirm / prompt / alert 是服务方法名
  'vue-render/src/contracts/feedback.ts',
  // 调试窗口的纯逻辑接口：deps.alert 由调用方注入，不是浏览器全局
  'plugins/plugin-node-ui/src/debugWindow.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // assets = 已构建产物（cloud-server/assets 里那份旧 bundle）；源码扫描只看 src。
    if (name === 'node_modules' || name === 'dist' || name === 'assets' || name === '__tests__' || name === 'e2e') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      // backup 目录跳过；`.mini-canvas-backup-*` 是后台跑起来时留下的数据快照（git 忽略），
      // 里面是技能自带脚本的副本，不是产品源码。
      if (name === 'backup' || name.startsWith('.mini-canvas-backup-')) continue
      walk(full, out)
    } else if (SOURCE_EXT.has(path.extname(name))) {
      out.push(full)
    }
  }
  return out
}

/** 去掉注释，避免文档里写“禁止 window.confirm”被当成违规 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'window.confirm', re: /\bwindow\s*\.\s*confirm\s*\(/ },
  { name: 'window.alert', re: /\bwindow\s*\.\s*alert\s*\(/ },
  { name: 'window.prompt', re: /\bwindow\s*\.\s*prompt\s*\(/ },
  { name: 'globalThis.confirm', re: /\bglobalThis\s*\.\s*confirm\s*\(/ },
  { name: 'globalThis.alert', re: /\bglobalThis\s*\.\s*alert\s*\(/ },
  { name: 'globalThis.prompt', re: /\bglobalThis\s*\.\s*prompt\s*\(/ },
  // 裸调用：排除定义与对象方法（xxx.confirm( / function confirm( / deps.alert( 都要求前面不是标识符点）
  { name: '裸 confirm()', re: /(^|[^\w.$])confirm\s*\(/m },
  { name: '裸 alert()', re: /(^|[^\w.$])alert\s*\(/m },
  { name: '裸 prompt()', re: /(^|[^\w.$])prompt\s*\(/m },
]

describe('全仓禁止浏览器原生弹窗', () => {
  const files = walk(packagesRoot)

  it('扫描到了真实源码（防止路径写错导致空扫描白白通过）', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('没有 window/globalThis 上的 confirm / alert / prompt', () => {
    const hits: string[] = []
    for (const file of files) {
      const rel = path.relative(packagesRoot, file).split(path.sep).join('/')
      if (EXCEPTIONS.has(rel)) continue
      const code = stripComments(readFileSync(file, 'utf-8'))
      for (const { name, re } of PATTERNS.slice(0, 6)) {
        if (re.test(code)) hits.push(rel + ' → ' + name)
      }
    }
    expect(hits, '请改用 ctx.get<FeedbackService>(\'feedback\') 或 feedbackService()').toEqual([])
  })

  it('没有裸 confirm() / alert() / prompt() 调用', () => {
    const hits: string[] = []
    for (const file of files) {
      const rel = path.relative(packagesRoot, file).split(path.sep).join('/')
      if (EXCEPTIONS.has(rel)) continue
      const code = stripComments(readFileSync(file, 'utf-8'))
      for (const { name, re } of PATTERNS.slice(6)) {
        if (re.test(code)) hits.push(rel + ' → ' + name)
      }
    }
    expect(hits).toEqual([])
  })
})
