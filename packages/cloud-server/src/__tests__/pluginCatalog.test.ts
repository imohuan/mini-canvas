/**
 * 插件管理清单（/plugin-catalog.json）与插件资源投放的单测。
 *
 * 锁三件事：
 * 1. 清单只收**声明了 miniCanvas.installable 的 UMD 插件**（ESM 产物与冷启动基础件都不列）；
 * 2. 插件资源能取到**非 js**（css / 图片 / 子目录），且带正确 MIME；
 * 3. 路径穿越与非白名单扩展名一律拒绝。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server'
import { KNOWN_GLOBALS } from '../plugins/catalog'
import { HOST_GLOBALS } from '../../../../packages/plugins/vite-plugin-lib'

/** 造一个插件目录：<dir>/<pkg>/{package.json, dist/<file>} */
async function makePluginsDir(spec: Record<string, { file: string; content: string; pkg?: object }>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-catalog-'))
  for (const [pkgName, { file, content, pkg }] of Object.entries(spec)) {
    const dist = path.join(root, pkgName, 'dist')
    await fs.mkdir(dist, { recursive: true })
    await fs.writeFile(path.join(dist, file), content)
    if (pkg) await fs.writeFile(path.join(root, pkgName, 'package.json'), JSON.stringify(pkg))
  }
  return root
}

const UMD = (global: string, args = '') =>
  '(function(e,t){t(e.' + global + '={}' + (args ? ',' + args : '') + ')})(this,function(e){e.name="x";e.apply=function(){}})'

describe('插件管理清单 /plugin-catalog.json', () => {
  it('KNOWN_GLOBALS 与打包端 HOST_GLOBALS 的值集一致（双源漂移守卫）', () => {
    const host = [...new Set(Object.values(HOST_GLOBALS))].sort()
    const catalog = [...new Set([...KNOWN_GLOBALS])].sort()
    expect(catalog).toEqual(host)
  })

  it('收录 installable 的 UMD 插件：url 相对本服务、带 globalName/requiresGlobals/文案', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo', 'e.Vue,e.MiniCanvasRender'),
        pkg: {
          name: '@mini-canvas/plugin-demo',
          version: '1.2.3',
          miniCanvas: { title: '示例插件', description: '说明', installable: true, pluginName: 'demo' },
        },
      },
    })
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    try {
      const json = (await (await s.app.fetch(new Request('http://localhost/plugin-catalog.json'))).json()) as {
        ok: boolean
        plugins: Array<Record<string, unknown>>
      }
      expect(json.ok).toBe(true)
      expect(json.plugins[0]).toMatchObject({
        id: 'plugin-demo',
        name: 'demo',
        title: '示例插件',
        description: '说明',
        url: '/plugins/plugin-demo/plugin-demo.js',
        globalName: 'MiniCanvasPluginDemo',
        requiresGlobals: ['Vue', 'MiniCanvasRender'],
        version: '1.2.3',
      })
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('未声明 installable 的插件不收录；声明了的 ESM 插件**要**收录（面板装云端客户端就靠它）', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-cold': { file: 'plugin-cold.js', content: UMD('MiniCanvasPluginCold'), pkg: { name: 'cold' } },
      // 自包含 ESM + installable → 收（format 判成 esm，面板走 manager.install({ url })）
      'plugin-esm': {
        file: 'plugin-esm.js',
        content: 'export const name = "esm\nexport function apply() {}',
        pkg: { miniCanvas: { installable: true } },
      },
      // 有裸模块名 import 的"伪 ESM" → 不收（data: URL 里解析不了裸模块名，装必炸）
      'plugin-bare': {
        file: 'plugin-bare.js',
        content: 'import { x } from "vue"\nexport const name = "bare"',
        pkg: { miniCanvas: { installable: true } },
      },
    })
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    try {
      const json = (await (await s.app.fetch(new Request('http://localhost/plugin-catalog.json'))).json()) as {
        plugins: Array<{ id: string; format?: string }>
        skipped: Array<{ file: string }>
      }
      expect(json.plugins.map((p) => p.id)).toEqual(['plugin-esm'])
      expect(json.plugins[0]?.format).toBe('esm')
      expect(json.skipped.some((x) => x.file === 'plugin-cold')).toBe(true)
      expect(json.skipped.some((x) => x.file === 'plugin-bare')).toBe(true)
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('自带插件（builtin）也列进清单，但带 builtin 标记（前端只读展示、不给装卸）', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-builtin-x': {
        file: 'plugin-builtin-x.js',
        content: UMD('MiniCanvasPluginBuiltinX', 'e.Vue'),
        pkg: { name: '@mini-canvas/plugin-builtin-x', miniCanvas: { title: '自带件', builtin: true, pluginName: 'builtin-x' } },
      },
      'plugin-ext': {
        file: 'plugin-ext.js',
        content: UMD('MiniCanvasPluginExt', 'e.Vue'),
        pkg: { name: '@mini-canvas/plugin-ext', miniCanvas: { installable: true, pluginName: 'ext' } },
      },
    })
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    try {
      const json = (await (await s.app.fetch(new Request('http://localhost/plugin-catalog.json'))).json()) as {
        plugins: Array<{ id: string; builtin?: boolean }>
      }
      const byId = new Map(json.plugins.map((p) => [p.id, p]))
      expect(byId.get('plugin-builtin-x')?.builtin).toBe(true)
      expect(byId.get('plugin-ext')?.builtin).toBeUndefined()
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('两份清单互不干扰：ESM 进 /plugin-manifest.json，UMD+installable 进 /plugin-catalog.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-esm': { file: 'plugin-esm.js', content: 'export const name = "esm"' },
      'plugin-umd': { file: 'plugin-umd.js', content: UMD('MiniCanvasPluginUmd'), pkg: { miniCanvas: { installable: true } } },
    })
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    try {
      const manifest = (await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()) as {
        plugins: Array<{ id: string }>
      }
      const catalog = (await (await s.app.fetch(new Request('http://localhost/plugin-catalog.json'))).json()) as {
        plugins: Array<{ id: string }>
      }
      expect(manifest.plugins.map((p) => p.id)).toEqual(['plugin-esm'])
      expect(catalog.plugins.map((p) => p.id)).toEqual(['plugin-umd'])
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('冷启动自带插件（builtin）不进 /plugin-manifest.json（data: URL import 裸模块名必炸）', async () => {
    // 实测背景：plugin-bottom-bar（builtin + ESM 产物）被列进 manifest，应用冷启动
    // install({ url }) 走 import(data:text/javascript)，产物里 external 的
    // "@mini-canvas/canvas-base" 在 data: URL 里解析不了 → 每次开页 console 报
    // "Failed to resolve module specifier"。它由 APP_PLUGINS 冷启动装配，清单不该列它。
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-builtin-esm': { file: 'plugin-builtin-esm.js', content: 'import { x } from "@mini-canvas/canvas-base";export const name = "b";export { x };' },
      'plugin-builtin-umd': { file: 'plugin-builtin-umd.js', content: UMD('MiniCanvasPluginBuiltinUmd') },
      'plugin-ext-esm': { file: 'plugin-ext-esm.js', content: 'export const name = "ext";' },
    })
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-builtin-esm', 'package.json'),
      JSON.stringify({ name: '@mini-canvas/plugin-builtin-esm', miniCanvas: { builtin: true, pluginName: 'b-esm' } }),
    )
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-builtin-umd', 'package.json'),
      JSON.stringify({ name: '@mini-canvas/plugin-builtin-umd', miniCanvas: { builtin: true, pluginName: 'b-umd' } }),
    )
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    try {
      const manifest = (await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()) as {
        plugins: Array<{ id: string }>
      }
      // builtin 两个都不列；普通 ESM 插件照列
      expect(manifest.plugins.map((p) => p.id)).toEqual(['plugin-ext-esm'])
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })
})

describe('前后端成对插件（Task 7）', () => {
  it('自带插件声明 serverBuiltin → 清单带 server 标记（让界面能显示自带件的后台状态）', async () => {
    const pluginsDir = await makePluginsDir({
      'plugin-builtin-with-be': {
        file: 'plugin-builtin-with-be.js',
        content: UMD('MiniCanvasPluginBuiltinWithBe'),
        pkg: {
          name: '@mini-canvas/plugin-builtin-with-be',
          miniCanvas: { builtin: true, pluginName: 'bwb', serverBuiltin: true },
        },
      },
      'plugin-builtin-fe-only': {
        file: 'plugin-builtin-fe-only.js',
        content: UMD('MiniCanvasPluginBuiltinFeOnly'),
        pkg: { name: '@mini-canvas/plugin-builtin-fe-only', miniCanvas: { builtin: true, pluginName: 'bfo' } },
      },
    })
    const srv = await createCloudServer({ port: 0, pluginsDir, watchProviders: false })
    const body = (await (await srv.app.fetch(new Request('http://x/plugin-catalog.json'))).json()) as {
      plugins: Array<{ id: string; builtin?: boolean; server?: unknown }>
    }
    expect(body.plugins.find((p) => p.id === 'plugin-builtin-with-be')?.server, '声明 serverBuiltin 的自带件应带 server').toBeTruthy()
    expect(body.plugins.find((p) => p.id === 'plugin-builtin-fe-only')?.server, '纯前端自带件没有 server').toBeUndefined()
    srv.stop()
  })

  it('包里有 dist/server.js → 清单项带 server.url 与 permissions', async () => {
    const pluginsDir = await makePluginsDir({
      'plugin-pair': {
        file: 'plugin-pair.js',
        content: UMD('MiniCanvasPluginPair'),
        pkg: {
          name: '@mini-canvas/plugin-pair',
          miniCanvas: { installable: true, pluginName: 'pair', serverPermissions: ['net', 'store'] },
        },
      },
    })
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-pair', 'dist', 'server.js'),
      'export const name = "pair-server"\nexport function apply() {}\n',
    )
    const srv = await createCloudServer({ port: 0, pluginsDir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/plugin-catalog.json'))
    const body = (await res.json()) as { plugins: Array<{ id: string; server?: { url: string; permissions?: string[] } }> }
    const pair = body.plugins.find((p) => p.id === 'plugin-pair')!
    expect(pair.server?.url).toBe('/plugins/plugin-pair/server.js')
    expect(pair.server?.permissions).toEqual(['net', 'store'])
    srv.stop()
  })

  it('只有前端产物 → 清单项没有 server（合法，不算错）', async () => {
    const pluginsDir = await makePluginsDir({
      'plugin-fe-only': {
        file: 'plugin-fe-only.js',
        content: UMD('MiniCanvasPluginFeOnly'),
        pkg: { name: '@mini-canvas/plugin-fe-only', miniCanvas: { installable: true, pluginName: 'fe-only' } },
      },
    })
    const srv = await createCloudServer({ port: 0, pluginsDir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/plugin-catalog.json'))
    const body = (await res.json()) as { plugins: Array<{ id: string; server?: unknown }> }
    expect(body.plugins.find((p) => p.id === 'plugin-fe-only')?.server).toBeUndefined()
    srv.stop()
  })
})

describe('插件资源投放：不只发 js', () => {

  async function bootWithAssets() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-doc-'))
    const pluginsDir = await makePluginsDir({
      'plugin-demo': { file: 'plugin-demo.js', content: UMD('MiniCanvasPluginDemo', 'e.Vue') },
    })
    const dist = path.join(pluginsDir, 'plugin-demo', 'dist')
    await fs.writeFile(path.join(dist, 'plugin-demo.css'), '.x{color:red}')
    await fs.writeFile(path.join(dist, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]))
    await fs.mkdir(path.join(dist, 'assets'), { recursive: true })
    await fs.writeFile(path.join(dist, 'assets', 'logo.svg'), '<svg/>')
    const s = await createCloudServer({ dir, pluginsDir, watchProviders: false })
    return { s, dir, pluginsDir }
  }

  it('css / png / 子目录 svg 都能取，且 MIME 正确', async () => {
    const { s, dir, pluginsDir } = await bootWithAssets()
    try {
      const css = await s.app.fetch(new Request('http://localhost/plugins/plugin-demo/plugin-demo.css'))
      expect(css.status).toBe(200)
      expect(css.headers.get('content-type')).toContain('text/css')
      expect(await css.text()).toBe('.x{color:red}')

      const png = await s.app.fetch(new Request('http://localhost/plugins/plugin-demo/icon.png'))
      expect(png.status).toBe(200)
      expect(png.headers.get('content-type')).toContain('image/png')

      const svg = await s.app.fetch(new Request('http://localhost/plugins/plugin-demo/assets/logo.svg'))
      expect(svg.status).toBe(200)
      expect(svg.headers.get('content-type')).toContain('image/svg+xml')
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('路径穿越 / 非白名单扩展名一律拒绝', async () => {
    const { s, dir, pluginsDir } = await bootWithAssets()
    try {
      // 注意：URL 里的上跳段会被 Request/URL 构造器**先归一化掉**（/plugins/a/UP/b → /plugins/b），
      // 所以 HTTP 层能测的是「归一化之后」的行为；真正的穿越防线在解析函数那一层（见下一条）。
      const exe = await s.app.fetch(new Request('http://localhost/plugins/plugin-demo/script.exe'))
      expect(exe.status).toBe(400)

      const evil = await s.app.fetch(
        new Request('http://localhost/plugins/plugin-demo/%2e%2e/%2e%2e/package.json'),
      )
      // 归一化后变成 /package.json → 落到静态层的 SPA 回落（index.html），绝不是插件目录里那个文件
      expect(await evil.text()).not.toContain('@mini-canvas/plugin-demo')
    } finally {
      s.stop()
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('解析函数层：多段穿越与非法段一律拒绝（URL 归一化之前的真实防线）', async () => {
    const { resolvePluginAsset } = await import('../static')
    const up = '..' // 上跳段（拆开写，免得被 URL 处理或词法误读）
    const bads = [
      '/plugins/a/' + up + '/b/x.js',
      '/plugins/pkg/./x.js',
      '/plugins/pkg//x.js',
      '/plugins/' + up + '/x.js',
      '/plugins/pkg/x.exe',
      '/plugins/pkg/.env',
      '/plugins/pkg/a/b/secret.ts',
    ]
    for (const bad of bads) {
      expect('error' in resolvePluginAsset(bad), '应拒绝: ' + bad).toBe(true)
    }
    // 合法：嵌套与扁平都放行
    expect(resolvePluginAsset('/plugins/pkg/pkg.js')).toEqual({ rel: 'pkg/dist/pkg.js' })
    expect(resolvePluginAsset('/plugins/pkg/assets/logo.svg')).toEqual({ rel: 'pkg/dist/assets/logo.svg' })
    expect(resolvePluginAsset('/plugins/flat.js')).toEqual({ rel: 'flat.js' })
  })

  it('同一插件两个目录（源码包 + NPM 装副本）只列一份，且优先已装副本', async () => {
    const dir = await makePluginsDir({
      // 仓库源码包：id 无 scope__ 前缀
      'plugin-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: { name: '@mini-canvas/plugin-demo', version: '1.0.0', miniCanvas: { installable: true, pluginName: 'demo', title: 'Demo' } },
      },
      // NPM 装进来的副本：带显式标记 npmInstalled（安装路由写入），pluginName 相同 → 同一个插件
      'mini-canvas__plugin-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: { name: '@mini-canvas/plugin-demo', version: '1.0.0', miniCanvas: { installable: true, pluginName: 'demo', title: 'Demo', npmInstalled: true } },
      },
    })
    const srv = await createCloudServer({ port: 0, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'cs-cat-dedup-')), pluginsDir: dir, watchProviders: false })
    const body = (await (await srv.app.fetch(new Request('http://x/plugin-catalog.json'))).json()) as { plugins: Array<{ id: string; name: string }> }
    const demo = body.plugins.filter((p) => p.name === 'demo')
    expect(demo, '同一插件只应列一份').toHaveLength(1)
    expect(demo[0].id, '保留已装副本（卸载只删它，不动源码）').toBe('mini-canvas__plugin-demo')
    srv.stop()
  })

  it('副本 id 不含 scope__（普通包名 mini-canvas-plugin-demo）时，去重仍靠 npmInstalled 生效', async () => {
    // 这是审查指出的回归场景：包名去 scope 后 id 不含 `__`。
    // 目录名故意让**源码包排在前面**（aaa 先于 zzz）—— 旧代码"保留先来的"会错误地保留源码，
    // 新代码靠 npmInstalled 标记仍能正确保留副本。这样这条测试才真正能分辨新旧行为。
    const dir = await makePluginsDir({
      'aaa-source-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: { name: '@mini-canvas/plugin-demo', miniCanvas: { installable: true, pluginName: 'demo', title: 'Demo' } },
      },
      'zzz-npm-copy-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: { name: 'mini-canvas-plugin-demo', miniCanvas: { installable: true, pluginName: 'demo', title: 'Demo', npmInstalled: true } },
      },
    })
    const srv = await createCloudServer({ port: 0, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'cs-cat-plain-')), pluginsDir: dir, watchProviders: false })
    const body = (await (await srv.app.fetch(new Request('http://x/plugin-catalog.json'))).json()) as {
      plugins: Array<{ id: string; name: string }>
    }
    const demo = body.plugins.filter((p) => p.name === 'demo')
    expect(demo, '同插件的两个目录只应列一份').toHaveLength(1)
    expect(demo[0].id, '保留带 npmInstalled 标记的副本（不是排在前面那份源码）').toBe('zzz-npm-copy-demo')
    srv.stop()
  })

  it('源码包不声明 installable → 不列入；NPM 装的那份声明了 → 列入（避免重复只留一份）', async () => {
    const dir = await makePluginsDir({
      // 仓库源码包：已发布到 NPM，作者故意不声明 installable → 不列
      'plugin-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: {
          name: '@mini-canvas/plugin-demo',
          version: '1.0.0',
          miniCanvas: { pluginName: 'demo', title: 'Demo', web: { entry: 'dist/plugin-demo.js' } },
        },
      },
      // NPM 装进来的副本：安装时会被补上 installable: true → 照常列
      'mini-canvas__plugin-demo': {
        file: 'plugin-demo.js',
        content: UMD('MiniCanvasPluginDemo'),
        pkg: {
          name: '@mini-canvas/plugin-demo',
          version: '1.0.0',
          miniCanvas: { installable: true, pluginName: 'demo', title: 'Demo', web: { entry: 'dist/plugin-demo.js' } },
        },
      },
    })
    const srv = await createCloudServer({ port: 0, dir: await fs.mkdtemp(path.join(os.tmpdir(), 'cs-cat-pub-')), pluginsDir: dir, watchProviders: false })
    const body = (await (await srv.app.fetch(new Request('http://x/plugin-catalog.json'))).json()) as {
      plugins: Array<{ id: string }>
      skipped: Array<{ file: string; reason: string }>
    }
    expect(body.plugins.map((p) => p.id)).toEqual(['mini-canvas__plugin-demo'])
    expect(body.skipped.some((s) => s.file === 'plugin-demo' && s.reason.includes('installable'))).toBe(true)
    srv.stop()
  })
})
