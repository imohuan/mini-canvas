/**
 * start / stop 的进程层逻辑：状态文件、命令识别、端口扫描。
 *
 * 这里只测「判断」和「读写小文件」；真起进程的那部分靠 CLI 手动实测
 * （Chrome/终端验证），不放进单测，免得测试自己变成进程管理器。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearServerState,
  isPlumeServerCommand,
  isProcessAlive,
  readServerState,
  serverLogFile,
  serverStateFile,
  writeServerState,
} from '../serviceControl.js'

describe('服务状态文件', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-state-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('状态文件与日志都落在数据根下', () => {
    expect(serverStateFile(dir)).toBe(path.join(path.resolve(dir), 'server-state.json'))
    expect(serverLogFile(dir)).toBe(path.join(path.resolve(dir), 'server.log'))
  })

  it('写完能读回同样的 pid / 端口', () => {
    writeServerState(dir, { pid: 4321, port: 8865, url: 'http://127.0.0.1:8865', startedAt: 'now' })
    const state = readServerState(dir)
    expect(state).toMatchObject({ pid: 4321, port: 8865, url: 'http://127.0.0.1:8865' })
  })

  it('文件损坏或缺失时返回 null，不抛异常', async () => {
    expect(readServerState(dir)).toBeNull()
    await fs.writeFile(serverStateFile(dir), '{ 坏掉的 json', 'utf8')
    expect(readServerState(dir)).toBeNull()
  })

  it('pid 不是正整数时当作没有记录（防止 stop 去 kill 0）', async () => {
    await fs.writeFile(serverStateFile(dir), JSON.stringify({ pid: 0, port: 8865 }), 'utf8')
    expect(readServerState(dir)).toBeNull()
  })

  it('清理时只清自己那份，别把另一个实例的记录删了', () => {
    writeServerState(dir, { pid: 100, port: 8865, url: '', startedAt: '' })
    clearServerState(dir, 200)
    expect(readServerState(dir)?.pid).toBe(100)
    clearServerState(dir, 100)
    expect(readServerState(dir)).toBeNull()
  })
})

describe('进程判断', () => {
  it('当前进程一定活着', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('非法 pid 一律当作不存在', () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(1.5)).toBe(false)
  })

  it('只把 plume-canvas 的命令行认成自己人', () => {
    // 发布包（npx 缓存路径里带包名）
    expect(isPlumeServerCommand('node /root/.npm/_npx/abc/node_modules/@plume-canvas/server/dist/cli.js serve')).toBe(true)
    // 仓库开发态（tsx 跑 src/cli.ts；路径里有 canvas）
    expect(isPlumeServerCommand('node --import tsx D:/Code/Git/mini-canvas/apps/server/src/cli.ts serve -p 8865')).toBe(true)
    // 别人家的程序
    expect(isPlumeServerCommand('"C:\\Program Files\\nodejs\\node.exe" -e require(\'http\')')).toBe(false)
    expect(isPlumeServerCommand('nginx: worker process')).toBe(false)
    // 别家项目的 cli.js serve：不能替用户做主杀掉
    expect(isPlumeServerCommand('node D:/other/some-cli/dist/cli.js serve')).toBe(false)
    expect(isPlumeServerCommand('')).toBe(false)
  })
})
