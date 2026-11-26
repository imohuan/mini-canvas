/**
 * CLI 参数：子命令识别、端口提示、后台启动参数还原。
 *
 * 大部分用例直接 import 测（cli.ts 现在只有「被直接执行」时才跑 main，
 * import 不会把测试进程带走）；只留一条子进程用例证明命令真的能跑起来 ——
 * 每条子进程都要现起一个 tsx，太多会和别的重测试抢 CPU、把 5 秒超时撞爆。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs, portBusyMessage, serveArgsOf, stopHintOf } from '../cli.js'

const CLI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  // 用 node --import tsx 直接跑源码：不依赖 .bin/tsx 的路径（Windows 上那是 .cmd，
  // spawnSync 不走 shell 时会报「不是可执行程序」，实测踩过）。
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI_SRC, ...args], {
    encoding: 'utf8',
    cwd: path.resolve(path.dirname(CLI_SRC), '..'),
    timeout: 60_000,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('CLI 子命令', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'plume-cli-'))
  })
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('子命令与端口都能解析（默认是 serve）', async () => {
    expect((await parseArgs(['node', 'cli'])).command).toBe('serve')
    const opts = await parseArgs(['node', 'cli', 'stop', '-p', '6091', '--force'])
    expect(opts.command).toBe('stop')
    expect(opts.port).toBe(6091)
    expect(opts.force).toBe(true)
  })

  it('两个子命令一起给要报错', async () => {
    await expect(parseArgs(['node', 'cli', 'stop', 'status'])).rejects.toThrow('不能同时使用')
  })

  it('端口冲突的提示要写清 stop 怎么用', () => {
    const message = portBusyMessage(8865)
    expect(message).toContain('端口 8865 已被占用')
    expect(message).toContain('plume-canvas stop')
    expect(message).toContain('--force')
  })

  it('后台启动要把参数原样带给子进程', async () => {
    const opts = await parseArgs([
      'node', 'cli', 'start', '-p', '6000', '-d', 'D:/x', '--no-mcp',
      '--trusted-origin', 'http://localhost:5288', '--no-open',
    ])
    const args = serveArgsOf(opts)
    expect(args[0]).toBe('serve')
    expect(args).toContain('6000')
    expect(args).toContain('D:/x')
    expect(args).toContain('--no-mcp')
    expect(args).toContain('http://localhost:5288')
    expect(args).toContain('--no-open')
  })

  it('stop 提示要带上用户自己的数据目录与端口', async () => {
    const opts = await parseArgs(['node', 'cli', 'start', '-p', '6000', '-d', 'D:/my data'])
    const hint = stopHintOf(opts)
    expect(hint).toBe('npx plume-canvas stop -d "D:/my data" -p 6000')
  })

  it('真的能跑：status 报告端口空闲，logs 没有文件时指路', () => {
    const status = runCli(['status', '-p', '6091', '-d', dir])
    expect(status.stdout).toContain('服务没在运行（端口 6091 空闲）')

    const lines = Array.from({ length: 30 }, (_, i) => '第 ' + (i + 1) + ' 行')
    fs.writeFileSync(path.join(dir, 'server.log'), lines.join('\n') + '\n', 'utf8')
    const logs = runCli(['logs', '-d', dir, '-n', '3'])
    expect(logs.stdout).toContain('第 28 行')
    expect(logs.stdout).toContain('第 30 行')
    expect(logs.stdout).not.toContain('第 20 行')
  })
})
