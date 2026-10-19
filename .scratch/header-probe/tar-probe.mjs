/**
 * 探针 V：`extractTarball` 用的 `tar -xzf ... --strip-components=1` 会不会被
 * 恶意 tarball 里的 `../` 条目写到目标目录之外？
 *
 * 做法：造两个 tar（一个带 ../evil.txt，一个带符号链接），用与源码完全相同的命令解压，
 * 看目标目录外有没有多出文件。
 */
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'

const run = promisify(execFile)
const root = mkdtempSync(path.join(os.tmpdir(), 'mc-tar-'))
const build = path.join(root, 'build')
const dest = path.join(root, 'dest')
mkdirSync(build, { recursive: true })
mkdirSync(dest, { recursive: true })

// tar 里通常带一个顶层目录（npm 包是 package/），源码用 --strip-components=1 剥掉
mkdirSync(path.join(build, 'package'), { recursive: true })
writeFileSync(path.join(build, 'package', 'package.json'), '{"name":"evil"}')

const tar = path.join(root, 'evil.tgz')

// 看本机 tar 是 GNU 还是 bsdtar
let version = ''
try { version = execFileSync('tar', ['--version'], { encoding: 'utf8' }).split('\n')[0] } catch (e) { version = String(e.message) }
console.log('tar:', version)

// 造一个含 ../ 条目的 tar。
// 关键：外层目录单独建一个 src，避免「解压到 root 外面」和「我们本来就在 root 里」混淆。
const src = path.join(root, 'src')
mkdirSync(path.join(src, 'package'), { recursive: true })
writeFileSync(path.join(src, 'package', 'package.json'), '{"name":"evil"}')
writeFileSync(path.join(src, 'evil-outside.txt'), 'payload')

const list = path.join(root, 'list.txt')
writeFileSync(list, ['package/package.json', '../evil-outside.txt'].join('\n'))

try {
  await run('tar', ['-czf', tar, '-C', src, '-T', list])
  console.log('打包成功（含 ../ 条目）')
} catch (e) {
  console.log('打包失败：', String(e.message).split('\n')[0])
}

// 解压前：root 下不应有 evil-outside.txt（src 里那个不算 root）
const beforeRoot = existsSync(path.join(root, 'evil-outside.txt'))
console.log('解压前 root/evil-outside.txt 存在:', beforeRoot)

try {
  await run('tar', ['-xzf', tar, '-C', dest, '--strip-components=1'])
  console.log('解压完成（无报错）')
} catch (e) {
  console.log('解压报错：', String(e.message).split('\n')[0])
}

console.log('dest 内容:', readdirSync(dest))
console.log('解压后 root/evil-outside.txt 存在:', existsSync(path.join(root, 'evil-outside.txt')))
console.log('解压后 root/../evil-outside.txt 存在:', existsSync(path.join(root, '..', 'evil-outside.txt')))

rmSync(root, { recursive: true, force: true })
