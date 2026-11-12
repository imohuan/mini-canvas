import fs from 'node:fs'
import path from 'node:path'

// 文档站全量审计脚本（保留在仓库里，改完文档跑一遍即可）：
//   node packages/docs/.vitepress/audit.mjs
// 核查：①内链不死链 ②侧边栏覆盖所有页面（无孤儿页） ③占位清零 ④示例文件头路径真实

const root = process.cwd()
const docsRoot = path.join(root, 'packages/docs')
const bs = String.fromCharCode(92)
let problems = 0

// ---------- 收集页面 ----------
const pages = []
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name)
    if (f.isDirectory()) {
      if (!/node_modules|dist|cache|public.examples/.test(p)) walk(p)
    } else if (f.name.endsWith('.md')) pages.push(p)
  }
}
walk(docsRoot)

// ---------- 侧边栏链接 ----------
const cfg = fs.readFileSync(path.join(docsRoot, '.vitepress/config.ts'), 'utf8')
const sidebarLinks = [...cfg.matchAll(/link: '([^']+)'/g)].map(m => m[1])
const sidebarSet = new Set(sidebarLinks)

// md 文件 → 站内 URL（index.md → 目录 URL）
function urlOf(p) {
  // 关键：docsRoot 经 path.join 是正斜杠混合形态（packages/docs），而 p 的分隔符是系统分隔符。
  // 统一成系统分隔符前缀再做截取，否则 "packages/docs\canvas-render" 不以 "packages\docs" 开头，
  // substring 截取错位 → z-index 这类名字含 index 的文件被咬成 z-（实测坑）。
  const prefix = docsRoot.split(bs).join('/')
  const rel = p.split(bs).join('/').substring(prefix.length + 1)
  // 关键：先去 .md，再去 index（如果命中）。直接 slice(8) 会把 z-INDEX.md 咬成 z-（实测坑）：
  // 'z-index.md'.endsWith('index.md') === true，但那是名字里的 index，不是文件类型后缀。
  const noExt = rel.slice(0, -'.md'.length)
  const base = noExt.endsWith('/index') ? noExt.slice(0, -'/index'.length) : noExt
  return '/' + base
}

// ---------- ① 内链 ----------
const distRoot = path.join(docsRoot, '.vitepress/dist')
const distExists = fs.existsSync(distRoot)
const broken = []
for (const p of pages) {
  const c = fs.readFileSync(p, 'utf8')
  for (const m of c.matchAll(/\]\((\/[^)#\s]+)(#[^)]*)?\)/g)) {
    const link = m[1].replace(/\/$/, '')
    if (/\.(png|svg|json)$/.test(link)) continue
    const t1 = path.join(docsRoot, link.slice(1) + '.md')
    const t2 = path.join(docsRoot, link.slice(1), 'index.md')
    if (!distExists && !fs.existsSync(t1) && !fs.existsSync(t2)) broken.push(path.basename(p) + ' -> ' + link)
    if (distExists) {
      const d1 = path.join(distRoot, link.slice(1) + '.html')
      const d2 = path.join(distRoot, link.slice(1), 'index.html')
      if (!fs.existsSync(d1) && !fs.existsSync(d2)) broken.push(path.basename(p) + ' -> ' + link)
    }
  }
}
if (broken.length) { problems++; console.log('✗ 内链死链 ' + broken.length + ' 处:'); broken.forEach(b => console.log('   ' + b)) }
else console.log('✓ 内链全部可达')

// ---------- ② 侧边栏覆盖（孤儿页） ----------
const orphans = []
for (const p of pages) {
  const url = urlOf(p).replace(/\/$/, '')
  // urlOf 用的是「文件相对 docsRoot」的 rel —— 但 walk 是从 docsRoot 出发的，
  // 传进来的 p 已是绝对路径，substring(docsRoot.length + 1) 得到的是 siteRel（正确）。
  // z-index 误报排查：打印诊断
  if (sidebarSet.has(url) || sidebarSet.has(url + '/')) continue
  // 首页 / README / 内部写作规范不算孤儿（首页是 layout:home 入口；README 与
  // WRITING-GUIDE 不进站点导航是设计如此）
  if (/(^|\/)(index|README)\.md$/.test(p.split(bs).join('/'))) continue
  if (p.endsWith('WRITING-GUIDE.md')) continue
  let linked = false
  for (const o of pages) {
    if (o === p) continue
    const c = fs.readFileSync(o, 'utf8')
    if (c.includes('(' + url + ')') || c.includes('(' + url + '/)')) { linked = true; break }
  }
  if (!linked) orphans.push(p.substring(docsRoot.length + 1).split(bs).join('/'))
}
if (orphans.length) { problems++; console.log('✗ 孤儿页（不在侧边栏也无人链接）:'); orphans.forEach(o => console.log('   ' + o)) }
else console.log('✓ 侧边栏覆盖全部页面（无孤儿）')

// ---------- ③ 占位 ----------
const placeholders = pages.filter(p => fs.readFileSync(p, 'utf8').includes('本篇待补全'))
if (placeholders.length) { problems++; console.log('✗ 占位未清:'); placeholders.forEach(p => console.log('   ' + p.substring(docsRoot.length + 1))) }
else console.log('✓ 无占位残留')

// ---------- ④ 示例文件头路径真实 ----------
const exRoot = path.join(docsRoot, 'public/examples')
let exChecked = 0, exBad = 0
if (fs.existsSync(exRoot)) {
  function walkEx(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) walkEx(p)
      else if (/\.(ts|vue)$/.test(f.name)) {
        const first = fs.readFileSync(p, 'utf8').split(/\r?\n/)[0]
        const m = first.match(/文件：\s*([^\r\n]+?)(\s*-->)?\s*$/)
        if (m) {
          exChecked++
          const declared = m[1].trim().split(bs).join('/')
          const actual = p.substring(root.length + 1).split(bs).join('/')
          if (declared !== actual) { exBad++; if (exBad <= 5) console.log('   头不一致: ' + actual + ' 声称=' + declared) }
        }
      }
    }
  }
  walkEx(exRoot)
}
if (exBad) { problems++; console.log('✗ 示例文件头路径不一致 ' + exBad + ' / ' + exChecked) }
else console.log('✓ 示例文件头路径全部真实（核对 ' + exChecked + ' 个）')

// ---------- ⑤ 标题唯一（每篇恰好一个真 H1，且前两行不同时为 H1）----------
const dupTitle = []
const multiH1 = []
for (const p of pages) {
  const rel = p.substring(docsRoot.length + 1).split(bs).join('/')
  if (/(^|\/)(index|README)\.md$/.test(rel) || p.endsWith('WRITING-GUIDE.md')) continue
  const L = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  if (L[0] && L[0].startsWith('# ') && L[1] && L[1].startsWith('# ')) dupTitle.push(rel)
  let fence = false
  let real = 0
  for (let i = 0; i < L.length; i++) {
    const l = L[i]
    if (l.startsWith('```')) { fence = !fence; continue }
    if (!fence && /^#\s/.test(l)) real++
  }
  if (real !== 1) multiH1.push(rel + ' (h1=' + real + ')')
}
if (dupTitle.length) { problems++; console.log('✗ 标题重复（前两行都是 H1）:'); dupTitle.forEach((x) => console.log('   ' + x)) }
else if (multiH1.length) { problems++; console.log('✗ H1 数量不是 1:'); multiH1.forEach((x) => console.log('   ' + x)) }
else console.log('✓ 每篇恰好一个 H1、无标题重复')

// ---------- ⑥ 示例配套「文件：」头路径真实（public/examples 下）----------
const badExHeader = []
for (const p of pages) {
  const c = fs.readFileSync(p, 'utf8')
  for (const m of c.matchAll(/文件：\s*([^\r\n]+)/g)) {
    let decl = m[1].replace(/\s*(-->|\*\/)\s*$/, '').trim()
    const cut = [decl.indexOf('（'), decl.indexOf('('), decl.indexOf('——'), decl.indexOf(' 里')].filter((x) => x > 0)
    if (cut.length) decl = decl.slice(0, Math.min(...cut)).trim()
    const rel = decl.split('\\').join('/')
    if (!rel.startsWith('packages/docs/public/examples/')) continue
    if (!fs.existsSync(path.join(root, rel))) badExHeader.push(p.substring(docsRoot.length + 1).split(bs).join('/') + ' :: ' + rel)
  }
}
if (badExHeader.length) { problems++; console.log('✗ 示例文件头声称的 public/examples 路径不存在:'); badExHeader.forEach((x) => console.log('   ' + x)) }
else console.log('✓ 示例文件头里的 public/examples 路径全部存在')

console.log(problems === 0 ? '\n全部通过。' : '\n共 ' + problems + ' 类问题。')
process.exitCode = problems === 0 ? 0 : 1
