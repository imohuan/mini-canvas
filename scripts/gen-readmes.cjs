// gen-readmes - 扫描插件源码生成统一格式 README.md
const { readFile, writeFile, readdir } = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const PLUGINS = 'D:/Code/Git/mini-canvas/packages/plugins'

function rgAll(d) {
  try {
  return execFileSync('rg', ['--no-heading', '-g', '*.ts', '-g', '*.vue', '-g', '!**/__tests__/**', '.', d], { cwd: d, encoding: 'utf8', shell: true })
  } catch (e) {
    return String(e.stdout || '')
  }
}

function matchAll(src, re) {
  const out = new Set()
  let m
  while ((m = re.exec(src))) out.add(m[1])
  return [...out]
}

const SLOT_RE = /slots\.register\(\s*["']([^"']+)["'\s*,]/g
const PROVIDE_RE = /ctx\.(?:inject|provide)\(\s*["']([^"']+)["'\s*,]/g
const INJECT_RE = /export const inject = \[([^\]]*)\]/g
const KEYS_RE = /keys:\s*\[?["'](mod[+-][a-zA-Z]+|[a-zA-Z]+)["']?/g;

(async () => {
  const dirs = (await readdir(PLUGINS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('plugin-'))
    .map((d) => d.name)
  let n = 0
  for (const dir of dirs) {
    const pkgDir = path.join(PLUGINS, dir)
    const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'))
    const plume = pkg.plume || {}
    const title = plume.title || dir
    const desc = plume.description || ''
    const src = rgAll(path.join(pkgDir, 'src'))
    let header = ''
    for (const cand of ['index.ts', dir.replace('plugin-', '') + 'Plugin.ts', 'plugin.ts']) {
      try {
        const main = await readFile(path.join(pkgDir, 'src', cand), 'utf8')
        const m = main.match(/^\/\*[\s\S]*?\*\//)
        if (m) { header = m[0]; break }
      } catch (e) {}
    }
    const slots = matchAll(src, SLOT_RE)
    const provides = matchAll(src, PROVIDE_RE)
    const injectDecl = matchAll(src, INJECT_RE)
    const keys = matchAll(src, KEYS_RE)
    const providesPkg = plume.provides || []
    const depsPkg = plume.dependencies || []
    const L = []
    L.push('# ' + title)
    L.push('')
    L.push('> `' + (pkg.name || dir) + '` - v' + (pkg.version || '0.1.0'))
    L.push('')
    if (desc) { L.push(desc + '.'); L.push('') }
    if (header) {
      const body = header.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).filter((l) => l.trim() && !/^\s*\*\/$/.test(l) && !/^\/\*\*$/.test(l)).join('\n')
      L.push('## 功能说明', '', body, '')
    }
    L.push('## 注册项', '')
    if (provides.length || providesPkg.length) {
      L.push('### 提供的服务 (ctx.inject / provide)', '')
      for (const s of new Set([...provides, ...providesPkg])) L.push('- `' + s + '`')
      L.push('')
    }
    if (injectDecl.length) {
      L.push('### 声明的依赖 (export const inject)', '')
      for (const s of injectDecl) L.push('- `' + s.trim() + '`')
      L.push('')
    }
    if (slots.length) {
      L.push('### 注册的插槽 (slots.register)', '')
      for (const s of slots) L.push('- `' + s + '`')
      L.push('')
    }
    if (keys.length) {
      L.push('### 快捷键', '')
      for (const k of new Set(keys)) L.push('- `' + k + '`')
      L.push('')
    }
    if (depsPkg.length) {
      L.push('### 依赖的插件能力 (plume.dependencies)', '')
      for (const d of depsPkg) L.push('- `' + d + '`')
      L.push('')
    }
    if (L[L.length - 1] !== '') L.push('')
    L.push('## 安装', '', '```bash', 'npm i ' + (pkg.name || dir), '```', '')
    L.push('本插件随 plume-canvas 主程序自动安装；也可通过插件管理页手动装卸。', '')
    await writeFile(path.join(pkgDir, 'README.md'), L.join('\n'), 'utf8')
    console.log('OK', dir, 'slots:' + slots.length, 'svc:' + provides.length, 'keys:' + keys.length)
    n++
  }
  console.log('total:', n)
})()
