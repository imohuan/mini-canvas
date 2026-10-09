/**
 * res: → URL 迁移脚本单测（scripts/migrate-res-to-url.mjs）。
 *
 * 锁的是三件事：
 *   1. **转换正确**：只动「合法 res:<16位十六进制[.扩展名]>」，其它值逐字不变；
 *   2. **备份不覆盖**：每跑一次都留一份新的 canvas.json.bak-*，原件永远拿得回来；
 *   3. **写后复查**：写完自动再扫一遍，残留会报出来并以退出码 1 结束。
 *
 * 用 child_process 真跑脚本（端到端），这样命令行参数、退出码、打印都一起验到。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../scripts/migrate-res-to-url.mjs', import.meta.url))

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-migrate-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 造一个画布文件，返回它的绝对路径 */
async function writeCanvas(id: string, json: unknown): Promise<string> {
  const dir = path.join(root, 'canvases', id)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'canvas.json')
  await fs.writeFile(file, JSON.stringify(json), 'utf8')
  return file
}

/** 跑脚本（默认不带参数会写盘；传 ['--dry-run'] 等自行指定） */
function run(args: string[] = []): string {
  return execFileSync(process.execPath, [SCRIPT, '--dir', root, ...args], { encoding: 'utf8' })
}

async function readCanvas(file: string): Promise<{ nodes: Array<{ id: string; data: Record<string, unknown> }> }> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function listBaks(file: string): Promise<string[]> {
  const names = await fs.readdir(path.dirname(file))
  return names.filter((n) => n.startsWith('canvas.json.bak-')).sort()
}

describe('迁移脚本：只把合法 res: 换成 URL', () => {
  it('九个媒体字段 + resourceId 全转；其它形态逐字不变', async () => {
    const id = '430c8f1f00bd4aba'
    const assetUrl = '/api/assets/files/ec96ba4464cbf531.jpeg'
    const external = 'https://cdn.example.com/pic.png'
    const alreadyUrl = '/api/canvases/' + id + '/resources/1111222233334444.png'
    const data: Record<string, unknown> = {
      imageUrl: 'res:0123456789abcdef.png',
      videoUrl: 'res:0123456789abcdef.mp4',
      audioUrl: 'res:0123456789abcdef', // 无扩展名也合法
      posterUrl: 'res:aaaaaaaaaaaaaaaa',
      thumbUrl: 'res:bbbbbbbbbbbbbbbb.jpg',
      maskUrl: 'res:cccccccccccccccc.png',
      panoUrl: 'res:dddddddddddddddd.webp',
      leftImageUrl: 'res:eeeeeeeeeeeeeeee.png',
      rightImageUrl: 'res:ffffffffffffffff.png',
      resourceId: 'res:0123456789abcdef.png',
      // 下面这些都不许动
      assetRef: assetUrl,
      externalRef: external,
      alreadyUrlRef: alreadyUrl,
      badRef: 'res:打错了的名字',
      shortRef: 'res:abc',
    }
    const file = await writeCanvas(id, {
      nodes: [{ id: '10', type: 'image', position: { x: 1, y: 2 }, data }],
      edges: [],
      name: '我的画布',
    })
    // 顺便覆盖「字段写在节点顶层」的防御分支
    const topLevel = await writeCanvas('c1', {
      nodes: [{ id: '20', type: 'video', imageUrl: 'res:0123456789abcdef.png', data: { label: '视频' } }],
      edges: [],
    })

    const out = run()
    expect(out).toContain('复查')
    expect(out).toContain('✔ 复查通过：已无 res: 可转换')

    const got = await readCanvas(file)
    const d = got.nodes[0].data
    const url = (name: string) => '/api/canvases/' + id + '/resources/' + name
    expect(d.imageUrl).toBe(url('0123456789abcdef.png'))
    expect(d.videoUrl).toBe(url('0123456789abcdef.mp4'))
    expect(d.audioUrl).toBe(url('0123456789abcdef'))
    expect(d.posterUrl).toBe(url('aaaaaaaaaaaaaaaa'))
    expect(d.thumbUrl).toBe(url('bbbbbbbbbbbbbbbb.jpg'))
    expect(d.maskUrl).toBe(url('cccccccccccccccc.png'))
    expect(d.panoUrl).toBe(url('dddddddddddddddd.webp'))
    expect(d.leftImageUrl).toBe(url('eeeeeeeeeeeeeeee.png'))
    expect(d.rightImageUrl).toBe(url('ffffffffffffffff.png'))
    expect(d.resourceId).toBe(url('0123456789abcdef.png'))
    // 非 res: / 不合法 res: 一律逐字不变
    expect(d.assetRef).toBe(assetUrl)
    expect(d.externalRef).toBe(external)
    expect(d.alreadyUrlRef).toBe(alreadyUrl)
    expect(d.badRef).toBe('res:打错了的名字')
    expect(d.shortRef).toBe('res:abc')
    // 顶层字段也转了，且用的是**那张画布自己的 id**
    const gotTop = await readCanvas(topLevel)
    expect((gotTop.nodes[0] as unknown as { imageUrl: string }).imageUrl).toBe('/api/canvases/c1/resources/0123456789abcdef.png')
    // nodes / edges / name 这些其它内容不受影响
    expect(got.nodes[0].id).toBe('10')
    expect((got as unknown as { name: string }).name).toBe('我的画布')
  })

  it('每跑一次都留一份新备份（原件字节原样，旧备份不被覆盖）', async () => {
    const file = await writeCanvas('c1', {
      nodes: [{ id: '1', type: 'image', data: { imageUrl: 'res:0123456789abcdef.png' } }],
      edges: [],
    })
    const original = await fs.readFile(file, 'utf8')

    run()
    const baksAfterFirst = await listBaks(file)
    expect(baksAfterFirst).toHaveLength(1)
    expect(await fs.readFile(path.join(path.dirname(file), baksAfterFirst[0]), 'utf8')).toBe(original)

    // 第二次跑：已经没有可转的 → 不改不动，也不新增备份
    run()
    expect(await listBaks(file)).toEqual(baksAfterFirst)
    expect(await fs.readFile(file, 'utf8')).not.toContain('res:')
  })

  it('备份同名时往后加序号（同一次窗口内连跑两次，两份备份都在）', async () => {
    const file = await writeCanvas('c1', {
      nodes: [{ id: '1', type: 'image', data: { imageUrl: 'res:0123456789abcdef.png' } }],
      edges: [],
    })
    const first = await fs.readFile(file, 'utf8')
    // 手工把文件改回 res:（模拟"还有第二处要转"），再跑一次 → 必须再留一份备份
    run()
    await fs.writeFile(file, first, 'utf8')
    const res = await fs.readFile(file, 'utf8')
    run()
    const baks = await listBaks(file)
    expect(baks.length).toBeGreaterThanOrEqual(2)
    const contents = await Promise.all(baks.map((b) => fs.readFile(path.join(path.dirname(file), b), 'utf8')))
    // 两份备份内容都在（至少有一份等于最初的 res: 版本），没有互相覆盖
    expect(contents).toContain(first)
    expect(contents.filter((c) => c === res).length).toBeGreaterThanOrEqual(1)
  })
})

describe('dry-run：只看不写', () => {
  it('未转换的目录：打印改动、但文件与备份一个都不动', async () => {
    const file = await writeCanvas('c1', {
      nodes: [{ id: '1', type: 'image', data: { imageUrl: 'res:0123456789abcdef.png' } }],
      edges: [],
    })
    const before = await fs.readFile(file, 'utf8')

    const out = run(['--dry-run'])
    expect(out).toContain('[dry-run]')
    expect(out).toContain('改了 1 个字段')
    // 干跑也会报"预演复查"：数出来就是「若真跑会改掉的那些」
    expect(out).toContain('剩余可转换的 res: 有 1 个')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    expect(await listBaks(file)).toEqual([])
  })

  it('已转换的目录：文件字节不变，复查为 0', async () => {
    const file = await writeCanvas('c1', {
      nodes: [{ id: '1', type: 'image', data: { imageUrl: 'res:0123456789abcdef.png' } }],
      edges: [],
    })
    run() // 先真转一次
    const after = await fs.readFile(file, 'utf8')

    const out = run(['--dry-run'])
    expect(out).toContain('无需改动')
    // 已经干净了 → 预演复查必须是 0
    expect(out).toContain('剩余可转换的 res: 有 0 个')
    expect(await fs.readFile(file, 'utf8')).toBe(after)
  })
})

describe('边界与参数', () => {
  it('数据根不存在 → 友好提示，不是崩溃', async () => {
    const missing = path.join(root, '没有这个目录')
    const out = execFileSync(process.execPath, [SCRIPT, '--dir', missing], { encoding: 'utf8' })
    expect(out).toContain('数据根不存在')
  })

  it('不认识的参数 → 报错并给出用法（退出码 1）', async () => {
    let code = 0
    let out = ''
    try {
      execFileSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' })
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      code = e.status ?? 0
      out = (e.stdout ?? '') + (e.stderr ?? '')
    }
    expect(code).toBe(1)
    expect(out).toContain('不认识的参数')
    expect(out).toContain('用法')
  })

  it('无需迁移的画布不写盘、不生成备份（本来就干净）', async () => {
    const file = await writeCanvas('c1', {
      nodes: [{ id: '1', type: 'image', data: { imageUrl: '/api/assets/files/x.jpeg' } }],
      edges: [],
    })
    const before = await fs.readFile(file, 'utf8')
    const out = run()
    expect(out).toContain('无需改动')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
    expect(await listBaks(file)).toEqual([])
  })
})
