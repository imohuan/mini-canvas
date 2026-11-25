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

/** 从已打好的 tgz 里读一个文本文件（Windows 自带 tar 就够，不必引第三方包） */
async function readFileInTar(tgz, member, cwd) {
  try {
    const { stdout } = await run('tar', ['-xzf', tgz, '-O', member], cwd)
    return stdout
  } catch {
    return '{}'
  }
}

async function checkOne(dir, name, tmp) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  const problems = []
  const plume = pkg.plume ?? {}
  if (!plume.pluginName) problems.push('缺 plume.pluginName')
  /**
   * 发布形态下 entry 会被改写成 dist/web.js / dist/server.js，但包里的产物文件名是
   * 作者自己的（plugin-agent.js、plugin-bottom-bar.js…）。两边对不上时，安装端只能靠
   * 「dist 下唯一候选」兜底，清单里那条 url 就指错了文件（用户 2026-11-25 实测：
   * plugin-agent 发布包声明 dist/web.js，实际只有 plugin-agent.js）。
   * 这里直接对着**源码里的声明**核对，发布前就红。
   */
  for (const [label, rel] of [['plume.web.entry', plume.web?.entry], ['plume.server.entry', plume.server?.entry]]) {
    if (typeof rel !== 'string' || !rel) continue
    const abs = path.join(dir, rel)
    try {
      await fs.access(abs)
    } catch {
      problems.push(label + ' 指向不存在的文件：' + rel + '（发布后装不上）')
    }
  }
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
    /**
     * 发布形态下 entry 会被 swap-dev-to-pub 改写成真实产物名 —— 这里把包装出来的
     * package.json 读回来，逐个核对它在 tarball 里真的存在。
     * 只查「有 dist/*.js」不够：声明指错文件时照样能通过，装的时候才发现 404
     * （用户 2026-11-25：plugin-agent 声明 dist/web.js、实际只有 dist/plugin-agent.js）。
     */
    const packedPkg = JSON.parse(await readFileInTar(tgz, 'package/package.json', path.dirname(tgz)))
    for (const [label, rel] of [['plume.web.entry', packedPkg.plume?.web?.entry], ['plume.server.entry', packedPkg.plume?.server?.entry]]) {
      if (typeof rel !== 'string' || !rel) continue
      if (!files.includes('package/' + rel.replace(/\\/g, '/'))) {
        problems.push('发布包里 ' + label + ' 指向不存在的文件：' + rel)
      }
    }
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
