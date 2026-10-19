/**
 * 探针 W：手工构造一个含 `../` 条目的 tar，测试 `tar -xzf ... --strip-components=1`
 * 会不会写到目标目录之外（= `npmClient.extractTarball` 的真实解压命令）。
 *
 * 为什么需要手写：bsdtar/GNU tar 打包时自己会拒绝 `../`，所以造不出恶意包，只能直接拼字节。
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'

const run = promisify(execFile)

/** 拼一个最小的 tar 条目（ustar 格式，512 字节头 + 内容补齐） */
function entry(name, content) {
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')   // mode
  header.write('0000000\0', 108, 8, 'ascii')   // uid
  header.write('0000000\0', 116, 8, 'ascii')   // gid
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii') // size
  header.write('00000000000\0', 136, 12, 'ascii') // mtime
  header.write('        ', 148, 8, 'ascii')    // chksum 占位（8 空格）
  header.write('0', 156, 1, 'ascii')           // typeflag: 普通文件
  header.write('ustar\0' + '00', 257, 8, 'ascii')
  // 计算校验和
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0)
  Buffer.from(content).copy(body)
  return Buffer.concat([header, body])
}

const root = mkdtempSync(path.join(os.tmpdir(), 'mc-tar3-'))
const dest = path.join(root, 'dest')
mkdirSync(dest, { recursive: true })

// 目录结构：root/dest（解压目标）、root/escape.txt（期望**不**被创建的越界文件）
const payload = 'PWNED-OUTSIDE'
const tarBuf = Buffer.concat([
  entry('package/package.json', '{"name":"evil"}'),
  entry('../escape.txt', payload),
  entry('../../escape2.txt', payload),
  Buffer.alloc(1024, 0), // 两个全零块 = 结束
])

const tgz = path.join(root, 'evil.tgz')
writeFileSync(tgz, gzipSync(tarBuf))

try {
  const v = await run('tar', ['--version'])
  console.log('tar:', (v.stdout ?? '').split('\n')[0])
} catch (e) {
  console.log('tar --version 失败:', String(e.message).split('\n')[0])
}

console.log('解压前：')
console.log('  dest:', readdirSync(dest))
console.log('  root:', readdirSync(root))

let err = ''
try {
  // 与 npmClient.extractTarball 完全相同的命令
  await run('tar', ['-xzf', tgz, '-C', dest, '--strip-components=1'])
} catch (e) {
  err = String(e.message).split('\n')[0]
}

console.log('解压报错:', err || '(无)  ← 注意 bsdtar 会把 ../escape.txt 写成 dest 内的 escape.txt，不算报错')
console.log('解压后：')
console.log('  dest:', readdirSync(dest))
console.log('  root:', readdirSync(root))
for (const p of [path.join(root, 'escape.txt'), path.join(root, '..', 'escape2.txt')]) {
  const hit = existsSync(p)
  console.log('  越界文件', p, hit ? '❌ 被创建了：' + readFileSync(p, 'utf8').slice(0, 20) : '✅ 不存在')
  if (hit) rmSync(p, { force: true })
}

rmSync(root, { recursive: true, force: true })
