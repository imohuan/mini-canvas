/**
 * importPack —— 导入时的**整包升版本**（用户 2026-10-13 拍板的那条规矩）。
 *
 * 钉的是那四处改名一处不能漏：脚本文件 / 依赖声明 / 界面里的引用 / 节点标题。
 * 漏一处的后果是"v2 的界面调着 v1 的脚本"——看着能跑、行为是混的，最难查。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planImport, rewriteHtmlRefs, titledWithVersion, VERSION_SEP } from '../task/importPack'
import type { UnpackedPack } from '../task/pack'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-import-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 造一个"拆好的包" */
function pack(scripts: Record<string, string>, html: string, data: Record<string, unknown>): UnpackedPack {
  return {
    manifest: { format: 1, name: 'x', at: 1, nodeType: 'ui', scripts: {}, missing: [] },
    node: { id: '9', type: 'ui', data: { ...data, uiHtml: html } },
    html,
    scripts,
    extra: [],
  }
}

const HTML = '<script>fetch(b, { body: JSON.stringify({ type: "call", name: "scale", methods: "run" }) })</script>'

describe('本机没有同名脚本 → 原样导入（不升版本）', () => {
  it('写入脚本，名字不动', async () => {
    const plan = await planImport(pack({ scale: 'export const run = 1' }, HTML, { label: '视频可视化' }), dir)
    expect(plan.action).toBe('as-is')
    expect(plan.write).toEqual([{ name: 'scale', text: 'export const run = 1' }])
    expect(plan.title).toBe('视频可视化')
    expect(plan.html).toBe(HTML)
  })
})

describe('同名且内容一样 → 跳过（幂等，重复导入无副作用）', () => {
  it('不写、不升版本', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = 1')
    const plan = await planImport(pack({ scale: 'export const run = 1' }, HTML, {}), dir)
    expect(plan.action).toBe('as-is')
    expect(plan.write).toEqual([])
    expect(plan.skip).toEqual(['scale'])
  })
})

describe('同名但内容不同 → **整包升版本**', () => {
  it('脚本名加 _v2，声明与界面引用一起改，标题也带 _v2', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = "本机那份"')
    const plan = await planImport(
      pack({ scale: 'export const run = "包里那份"' }, HTML, { label: '视频可视化', uiScripts: { scale: {} } }),
      dir,
    )
    expect(plan.action).toBe('bump')
    expect(plan.version).toBe(2)
    expect(plan.write).toEqual([{ name: 'scale' + VERSION_SEP + '2', text: 'export const run = "包里那份"' }])
    // ② 声明跟着换
    expect(plan.data.uiScripts).toEqual({ ['scale' + VERSION_SEP + '2']: {} })
    // ③ 界面里的引用跟着换
    expect(plan.html).toContain('name: "scale' + VERSION_SEP + '2"')
    expect(plan.html).not.toContain('name: "scale"')
    // ④ 标题带版本
    expect(plan.title).toBe('视频可视化' + VERSION_SEP + '2')
    expect(plan.data.label).toBe('视频可视化' + VERSION_SEP + '2')
    // ★ 界面代码必须是**改写后**的那份、且就在 data.uiHtml 里（落地时前端只用 node.data）
    //   漏了这条的后果：脚本改成 _v2、声明也改成 _v2，界面还在调老名字 → 导入完一点就 403
    expect(plan.data.uiHtml).toContain('name: "scale' + VERSION_SEP + '2"')
    expect(plan.data.uiHtml).not.toContain('name: "scale"')
  })

  it('_v2 被占了就往上找 _v3', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'local')
    await fs.writeFile(path.join(dir, 'scale' + VERSION_SEP + '2.mjs'), 'someone-else')
    const plan = await planImport(pack({ scale: 'from-pack' }, HTML, {}), dir)
    expect(plan.version).toBe(3)
    expect(plan.write[0]!.name).toBe('scale' + VERSION_SEP + '3')
  })

  it('多个脚本**共用一个版本号**（整包一套，不各升各的）', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'local-scale')
    const plan = await planImport(pack({ scale: 'pack-scale', crop: 'pack-crop' }, HTML, {}), dir)
    expect(plan.version).toBe(2)
    expect(plan.write.map((w) => w.name).sort()).toEqual(['crop' + VERSION_SEP + '2', 'scale' + VERSION_SEP + '2'])
  })

  it('一个冲突就整包升：另一个本机没有的也跟着改（保持一套）', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'local')
    const plan = await planImport(pack({ scale: 'pack', brand: 'brand-src' }, HTML, {}), dir)
    expect(plan.action).toBe('bump')
    expect(plan.write.map((w) => w.name).sort()).toEqual(['brand' + VERSION_SEP + '2', 'scale' + VERSION_SEP + '2'])
  })

  it('节点从没声明过 → 升版本后把新名字写进声明（否则自己反而调不动）', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'local')
    const plan = await planImport(pack({ scale: 'pack' }, HTML, { label: 'X' }), dir)
    expect(plan.data.uiScripts).toEqual({ ['scale' + VERSION_SEP + '2']: {} })
  })
})

describe('rewriteHtmlRefs —— 只改这次真的改名的那几个', () => {
  it('对象字面量与查询串两种写法都改', () => {
    const html = '{ name: "scale" } and ?name=scale&x=1 and name=\'scale\''
    const out = rewriteHtmlRefs(html, [{ from: 'scale', to: 'scale_v2' }])
    expect(out).toContain('{ name: "scale_v2" }')
    expect(out).toContain('?name=scale_v2&x=1')
    expect(out).toContain("name='scale_v2'")
  })

  it('**别的 name 一个字不动**（界面里满地是 name，乱改会改坏别人的东西）', () => {
    const html = '{ name: "我的输入框" }, { name: "scale" }, { name: "crop" }'
    const out = rewriteHtmlRefs(html, [{ from: 'scale', to: 'scale_v2' }])
    expect(out).toContain('"我的输入框"')
    expect(out).toContain('name: "crop"')      // crop 这次没改名
    expect(out).toContain('name: "scale_v2"')
  })
})

describe('titledWithVersion', () => {
  it('加后缀', () => {
    expect(titledWithVersion('视频可视化', 2)).toBe('视频可视化' + VERSION_SEP + '2')
  })
  it('已经带 _vN 的换掉，不叠成 _v2_v3', () => {
    expect(titledWithVersion('视频可视化' + VERSION_SEP + '2', 3)).toBe('视频可视化' + VERSION_SEP + '3')
  })
})

