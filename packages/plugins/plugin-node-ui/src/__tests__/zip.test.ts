/**
 * zip —— 自己写的 ZIP 读写。
 *
 * 两条都要验：**自己读回来**（往返一致）与**系统解压器也认** ——
 * 只测"自己读自己"会漏掉最要命的那种错：字节写歪了，只有别人打得开才发现。
 */
import { describe, it, expect } from 'vitest'
import { buildZip, readZip, crc32 } from '../task/zip'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

describe('crc32', () => {
  it('对已知输入给出标准值（"123456789" 的 CRC32 是 0xCBF43926）', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926)
  })
  it('空字节 → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('buildZip / readZip —— 往返', () => {
  it('多个文件原样读回（含文本与二进制）', () => {
    const bin = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const zip = buildZip([
      { name: 'manifest.json', data: enc('{"v":1}') },
      { name: 'scripts/scale.mjs', data: enc('export const run = () => 1') },
      { name: 'blob.bin', data: bin },
    ])
    const out = readZip(zip)
    expect(out.map((e) => e.name)).toEqual(['manifest.json', 'scripts/scale.mjs', 'blob.bin'])
    expect(dec(out[0]!.data)).toBe('{"v":1}')
    expect(dec(out[1]!.data)).toBe('export const run = () => 1')
    expect([...out[2]!.data]).toEqual([...bin])
  })

  it('不可压缩的内容也读得回来（走 store 那条路）', () => {
    // 高位不重复的字节几乎压不动 → 实现会退回 store（method 0），这条路同样要能读
    const rnd = new Uint8Array(2048)
    for (let i = 0; i < rnd.length; i++) rnd[i] = (i * 7919) % 251
    const out = readZip(buildZip([{ name: 'r.bin', data: rnd }]))
    expect([...out[0]!.data]).toEqual([...rnd])
  })

  it('相同输入 + 相同时间 → 字节完全一样（可复现）', () => {
    const t = new Date(2026, 0, 1, 0, 0, 0)
    const a = buildZip([{ name: 'a.txt', data: enc('hello') }], t)
    const b = buildZip([{ name: 'a.txt', data: enc('hello') }], t)
    expect([...a]).toEqual([...b])
  })

  it('空 ZIP 也能读（0 条记录）', () => {
    expect(readZip(buildZip([]))).toEqual([])
  })

  it('不是 ZIP 的字节 → 明确报错（不返回空数组冒充成功）', () => {
    expect(() => readZip(enc('这不是一个 zip 文件'))).toThrow(/ZIP/)
  })

  it('损坏的包（偏移指到文件外）→ 明确报错，不让它抛 RangeError', () => {
    const good = buildZip([{ name: 'a.txt', data: enc('hello') }])
    // 把中央目录项里的"本地头偏移"改成一个荒谬的大值
    const broken = new Uint8Array(good)
    const dv = new DataView(broken.buffer)
    // 中央目录项从文件头往后找签名
    let at = -1
    for (let i = 0; i + 4 <= broken.length; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) { at = i; break }
    }
    expect(at).toBeGreaterThan(0)
    dv.setUint32(at + 42, 0x7fffffff, true)
    expect(() => readZip(broken)).toThrow(/ZIP/)
  })

  it('★ 解压炸弹：声明"解开后很大"的包被拦下（不是靠输入大小挡）', () => {
    // 造一个高压缩比的内容（全 0 → deflate 压得极狠）
    const bomb = new Uint8Array(4 * 1024 * 1024)
    const zip = buildZip([{ name: 'bomb.bin', data: bomb }])
    // 包本身很小（压缩后），但解开是 4MB —— 限 1MB 时必须拒
    expect(zip.length).toBeLessThan(64 * 1024)
    expect(() => readZip(zip, 1024 * 1024)).toThrow(/太大/)
    // 上限够大时正常读回来
    expect(readZip(zip, 8 * 1024 * 1024)[0]!.data.length).toBe(bomb.length)
  })

  it('★ 解压炸弹（伪造声明值）：把 rawSize 写成 0 也拦得住', () => {
    // 审查指出：总量判断若只看包里声明的 rawSize，攻击者写 0 就能绕过。
    // 这条把「声明的解压后大小」篡改成 0，验证真正的闸是按**实际解出的字节**判的。
    const bomb = new Uint8Array(4 * 1024 * 1024)
    const zip = buildZip([{ name: 'bomb.bin', data: bomb }])
    const forged = new Uint8Array(zip)
    const dv = new DataView(forged.buffer)
    let at = -1
    for (let i = 0; i + 4 <= forged.length; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) { at = i; break }
    }
    expect(at).toBeGreaterThan(0)
    dv.setUint32(at + 24, 0, true) // 中央目录：声明的解压后大小 → 0
    let lh = -1
    for (let i = 0; i + 4 <= forged.length; i++) {
      if (dv.getUint32(i, true) === 0x04034b50) { lh = i; break }
    }
    expect(lh).toBeGreaterThanOrEqual(0)
    dv.setUint32(lh + 22, 0, true) // 本地头：同样篡改
    expect(() => readZip(forged, 1024 * 1024)).toThrow(/太大/)
  })
})

