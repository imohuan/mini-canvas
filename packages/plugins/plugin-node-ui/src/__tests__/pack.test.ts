/**
 * pack —— 节点包的打包与解包。
 *
 * 钉三件事：只带**声明过的**脚本、缺脚本要**如实报**（不静默）、往返一致。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildNodePack, readNodePack, PACK_FORMAT } from '../task/pack'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-pack-'))
  await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = (n) => n * 2\n')
  await fs.writeFile(path.join(dir, 'crop.mjs'), 'export const run = () => "crop"\n')
  // 机器上有、但节点**没有声明**的脚本 —— 绝不该被打进包
  await fs.writeFile(path.join(dir, 'secret.mjs'), 'export const run = () => "别人的脚本"\n')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 一个声明了 scale + crop 的节点 */
const node = {
  id: '2',
  type: 'ui',
  position: { x: 10, y: 20 },
  size: { w: 300, h: 200 },
  data: {
    label: '视频可视化',
    uiHtml: '<div>画点东西</div>',
    uiScripts: { scale: {}, crop: {} },
  },
}

describe('buildNodePack —— 打包', () => {
  it('四份东西齐全：manifest / node / ui.html / scripts', async () => {
    const { bytes, manifest } = await buildNodePack(node, dir, 1700000000000)
    const back = readNodePack(bytes)
    expect(back.manifest.format).toBe(PACK_FORMAT)
    expect(back.html).toBe('<div>画点东西</div>')
    expect(Object.keys(back.scripts).sort()).toEqual(['crop', 'scale'])
    expect(back.scripts.scale).toContain('n * 2')
    // node.json 原样带过去（导入那侧按它还原）
    expect((back.node as { data: { label: string } }).data.label).toBe('视频可视化')
    expect(manifest.name).toBe('视频可视化')
  })

  it('**只带声明过的**：机器上有别的脚本也不带走', async () => {
    const { bytes } = await buildNodePack(node, dir, 1)
    const back = readNodePack(bytes)
    expect(Object.keys(back.scripts)).not.toContain('secret')
    expect(back.extra.map((e) => e.name)).toEqual([])
  })

  it('声明了但机器上没有 → 如实写进 manifest.missing（不静默跳过）', async () => {
    const n2 = { ...node, data: { ...node.data, uiScripts: { scale: {}, 已经删掉的: {} } } }
    const { manifest } = await buildNodePack(n2, dir, 1)
    expect(manifest.missing).toEqual(['已经删掉的'])
    expect(Object.keys(manifest.scripts)).toEqual(['scale'])
  })

  it('没声明任何脚本 → 包里没有 scripts/（不是错误）', async () => {
    const n3 = { ...node, data: { ...node.data, uiScripts: {} } }
    const { bytes } = await buildNodePack(n3, dir, 1)
    expect(readNodePack(bytes).scripts).toEqual({})
  })

  it('manifest 里记了每个脚本的 sha256 与字节数（导入时据此判"同不同"）', async () => {
    const { manifest } = await buildNodePack(node, dir, 1)
    expect(manifest.scripts.scale!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.scripts.scale!.bytes).toBeGreaterThan(0)
  })

  it('同样输入 + 同样时间 → 字节完全一样（可复现，便于比对）', async () => {
    const a = await buildNodePack(node, dir, 42)
    const b = await buildNodePack(node, dir, 42)
    expect([...a.bytes]).toEqual([...b.bytes])
  })
})

describe('readNodePack —— 解包', () => {
  it('不是包 → 明确报错（不返回半成品）', () => {
    const junk = new TextEncoder().encode('随便一段文字，不是 zip')
    expect(() => readNodePack(junk)).toThrow(/节点包|ZIP/)
  })

  it('缺 manifest / node.json → 报"包不完整"', async () => {
    const { buildZip } = await import('../task/zip')
    const enc = (s: string) => new TextEncoder().encode(s)
    const bad = buildZip([{ name: 'ui.html', data: enc('<div></div>') }])
    expect(() => readNodePack(bad)).toThrow(/不完整/)
  })

  it('格式版本比本机新 → 明确拒绝（不硬读）', async () => {
    const { buildZip } = await import('../task/zip')
    const enc = (s: string) => new TextEncoder().encode(s)
    const bad = buildZip([
      { name: 'manifest.json', data: enc(JSON.stringify({ format: 99, name: 'x', at: 1, nodeType: 'ui', scripts: {}, missing: [] })) },
      { name: 'node.json', data: enc('{}') },
    ])
    expect(() => readNodePack(bad)).toThrow(/版本/)
  })
})

