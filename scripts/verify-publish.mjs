/**
 * verify-publish —— 发布质量闸（自动化自检,2026-11-23 用户要求）。
 *
 * 背景:0.1.16 直发时 plume.web.entry 丢失,导致市场列表缺插件 + 更新报「不是 plume 插件」。
 * 这类问题必须在**发布前**被自动化抓住,不能靠人工目测。
 *
 * 对每个声明了 plume 段的插件包(npm pack 模拟发布):
 *   1. plume.pluginName 存在;
 *   2. plume.web.entry(或 server.entry)存在;
 *   3. entry 指向的文件**真实存在于 tarball 里**;
 *   4. dependencies / devDependencies 无 workspace:*(npm publish 不替换,会导致装不上)。
 *
 * 用法:node scripts/verify-publish.mjs [插件名...](缺省检查全部)
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_ROOT = path.join(REPO, 'packages', 'plugins')
const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.stdout = stdout; err.stderr = stderr; reject(err) } else resolve({ stdout, stderr })
  })
})

async function checkOne(dir, name, tmp) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  const problems = []
  const plume = pkg.plume ?? {}
  if (!plume.pluginName) problems.push('缺 plume.pluginName')
  // 只跳过真正的私有包；hot-reload 从 0.1.1 起是可安装件（市场能搜到、要能装），
  // 再按名字跳过等于让它绕过发布闸门（用户 2026-11-25 要求一起发布）。
  const isDevOnly = pkg.private === true
  // 源码包的 plume 段本来就不带 entry —— entry 是发布管道(plugin-assets.mjs)回填的。
  // 这里检查「回填有据」:dist 里必须有可用的 js 产物,否则发布出去就是空包。
  let distFiles = []
  try {
    distFiles = (await fs.readdir(path.join(dir, 'dist'))).filter(f => f.endsWith('.js') && !f.endsWith('.map'))
  } catch { /* 没构建 */ }
  if (!isDevOnly && distFiles.length === 0) problems.push('没有 dist 产物(发布管道无据回填 entry)')
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [dep, ver] of Object.entries(pkg[section] ?? {})) {
      if (String(ver).startsWith('workspace:')) {
        if (section === 'dependencies' && !isDevOnly) problems.push(section + ' 里 ' + dep + ' 是 workspace:*(npm publish 不替换,装不上)')
      }
    }
  }
  // npm pack 验证 entry 文件真的进了 tarball
  if (!isDevOnly) {
    await run('npm', ['pack', '--pack-destination', tmp], dir)
    let tgz = path.join(tmp, `${pkg.name.replace(/^@/, '').replace('/', '__')}-${pkg.version}.tgz`)
    try {
      await fs.access(tgz)
    } catch {
      // scoped 包 @scope/name-version.tgz:名字里 scope 部分被去掉斜杠
      const alt = (await fs.readdir(tmp)).find(f => f.endsWith('-' + pkg.version + '.tgz'))
      if (!alt) { problems.push('npm pack 没有产出 tgz'); return problems }
      tgz = path.join(tmp, alt)
    }
    const { stdout } = await run('tar', ['-tzf', tgz], tmp)
    const files = stdout.split(/\r?\n/)
    // tarball 里必须至少有一个 dist/*.js(安装器靠它回填 entry,否则装出来是空包)
    const distInTar = files.filter(f => f.startsWith('package/dist/') && f.endsWith('.js') && !f.endsWith('.map'))
    if (distInTar.length === 0) problems.push('发布 tarball 里没有 dist/*.js(装出来是空包)')
  }
  return problems
}

const only = process.argv.slice(2)
const dirs = (await fs.readdir(PLUGINS_ROOT, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .filter(n => !n.startsWith('.') && !n.startsWith('_'))
  .filter(n => only.length === 0 || only.includes(n))

const tmp = await mkdtemp(path.join(os.tmpdir(), 'verify-pub-'))
let failed = 0
for (const name of dirs) {
  const dir = path.join(PLUGINS_ROOT, name)
  if (!(await fs.readdir(dir)).includes('package.json')) continue
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  if (!pkg.plume) continue
  let problems
  try {
    problems = await checkOne(dir, name, tmp)
  } catch (err) {
    problems = ['检查异常: ' + (err.stderr ?? err.message)]
  }
  if (problems.length === 0) {
    console.log('PASS ' + name)
  } else {
    failed++
    console.log('FAIL ' + name)
    for (const p of problems) console.log('     - ' + p)
  }
}
await rm(tmp, { recursive: true, force: true })
if (failed > 0) {
  console.error(`\n${failed} 个包未通过发布质量闸`)
  process.exit(1)
}
console.log('\n全部通过发布质量闸')
